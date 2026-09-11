import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { isAdminUser } from '@/lib/documentSecurity'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { checkDocumentShareable } from '@/lib/documents/shareGate'
import { documentReviewRevision } from '@/lib/documents/reviewRevision'

/** Staff-only eligibility, using exactly the same missing-field gate as sharing. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const { data: doc, error } = await sb.from('matter_documents')
    .select('id, name, r2_key, current_version_id, content_type, source, missing_count, reviewed_at, superseded_at')
    .eq('id', id).single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const eligibility = await checkDocumentShareable(doc)
  return NextResponse.json({ reviewRevision: documentReviewRevision(doc), reviewedAt: doc.reviewed_at, supersededAt: doc.superseded_at, eligibility }, { headers: { 'Cache-Control': 'private, no-store' } })
}
