import { NextResponse } from 'next/server'
import { getDocumentApiUser } from '@/lib/documentApiHelpers'
import { isAdminUser } from '@/lib/documentSecurity'
import { getAdminClient } from '@/lib/supabaseAdmin'

const AUDIT_COLUMNS = 'id, document_id, matter_id, user_email, action, metadata, document_name, created_at'

export async function GET(req: Request) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const matterId = url.searchParams.get('matterId')?.trim()
  const documentId = url.searchParams.get('documentId')?.trim()
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '25', 10)
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 25))

  if (!matterId) return NextResponse.json({ error: 'matterId is required' }, { status: 400 })

  let query = sb
    .from('document_access_audit')
    .select(AUDIT_COLUMNS)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (documentId) {
    query = query.eq('document_id', documentId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
