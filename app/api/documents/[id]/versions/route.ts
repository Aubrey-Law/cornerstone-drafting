import { NextResponse } from 'next/server'
import { auditDocumentAccess, isAdminUser, userCanReadDocument } from '@/lib/documentSecurity'
import { getDocumentApiUser } from '@/lib/documentApiHelpers'
import { listDocumentVersions } from '@/lib/documentVersions'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/** GET /api/documents/[id]/versions */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
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

  const audit = await auditDocumentAccess(sb, user, doc, 'version', {
    route: '/api/documents/[id]/versions',
  })
  if (!audit.ok) {
    return NextResponse.json({ error: 'Audit log write failed; access denied', code: 'audit_failed' }, { status: 503 })
  }

  try {
    const versions = await listDocumentVersions(sb, id)
    return NextResponse.json({
      versions,
      current_version_id: doc.current_version_id ?? null,
    })
  } catch (err) {
    // Table may not exist yet on firm DB
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('document_versions') || message.includes('schema cache')) {
      return NextResponse.json({ versions: [], current_version_id: null, unavailable: true })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Staff-only placeholder — versions are created by generate / redline / convert. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  await params
  return NextResponse.json(
    { error: 'Create versions via generate, AI redline, or convert-pdf' },
    { status: 405 },
  )
}
