import { NextResponse } from 'next/server'
import { isAdminUser, userCanReadDocument } from '@/lib/documentSecurity'
import {
  DOCX_CONTENT_TYPE,
  getDocumentApiUser,
  isDocxDocument,
  loadR2Bytes,
} from '@/lib/documentApiHelpers'
import { documentReviewRevision } from '@/lib/documents/reviewRevision'
import { loadActiveVersion } from '@/lib/documentVersions'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** GET /api/documents/[id]/docx — raw DOCX bytes for in-app viewer / redline. */
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
  // Sharing the current document does not publish its private revision history.
  if (versionId && !(await isAdminUser(sb, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isDocxDocument(doc)) {
    return NextResponse.json({ error: 'Not a DOCX document' }, { status: 415 })
  }

  try {
    const version = await loadActiveVersion(sb, id, versionId)
    if (versionId && !version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    const r2Key = version?.r2_key ?? doc.r2_key
    const bytes = await loadR2Bytes(r2Key)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': DOCX_CONTENT_TYPE,
        'X-Document-Revision': documentReviewRevision({ r2_key: r2Key, current_version_id: version?.id ?? doc.current_version_id }),
        'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[docx]', err)
    return NextResponse.json({ error: 'Could not load document bytes' }, { status: 500 })
  }
}
