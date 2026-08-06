import { NextResponse } from 'next/server'
import { userCanReadDocument } from '@/lib/documentSecurity'
import { getDocumentApiUser, isDocxDocument, loadR2Bytes } from '@/lib/documentApiHelpers'
import { extractTrackedChangeIds } from '@/lib/docxTrackedChanges'
import { loadActiveVersion } from '@/lib/documentVersions'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** GET /api/documents/[id]/tracked-change-ids?version_id= */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const versionId = new URL(req.url).searchParams.get('version_id')
  const sb = getAdminClient()
  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await userCanReadDocument(sb, user, doc))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isDocxDocument(doc)) {
    return NextResponse.json({ error: 'Not a DOCX document' }, { status: 415 })
  }

  const version = await loadActiveVersion(sb, id, versionId)
  const bytes = await loadR2Bytes(version?.r2_key ?? doc.r2_key)
  const ids = await extractTrackedChangeIds(bytes)
  return NextResponse.json({ ids })
}
