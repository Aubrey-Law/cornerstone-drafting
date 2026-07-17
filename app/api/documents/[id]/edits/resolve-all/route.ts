import { NextResponse } from 'next/server'
import { auditDocumentAccess, isAdminUser } from '@/lib/documentSecurity'
import { DOCX_CONTENT_TYPE, getDocumentApiUser, loadR2Bytes } from '@/lib/documentApiHelpers'
import { resolveTrackedChange } from '@/lib/docxTrackedChanges'
import { loadActiveVersion } from '@/lib/documentVersions'
import { putFileToR2 } from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * POST /api/documents/[id]/edits/resolve-all — accept or reject every pending
 * tracked change in one R2 read/write, instead of one request per change.
 * Body: { mode: 'accept' | 'reject' }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { mode?: string }
  const mode = body.mode === 'reject' ? 'reject' : body.mode === 'accept' ? 'accept' : null
  if (!mode) return NextResponse.json({ error: 'mode must be "accept" or "reject"' }, { status: 400 })

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: doc } = await sb.from('matter_documents').select(MATTER_DOCUMENT_COLUMNS).eq('id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: pending } = await sb
    .from('document_edits')
    .select('id, del_w_id, ins_w_id')
    .eq('document_id', id)
    .eq('status', 'pending')

  if (!pending || pending.length === 0) {
    return NextResponse.json({ resolved: 0, remaining_pending: 0 })
  }

  const audit = await auditDocumentAccess(sb, user, doc, 'edit', {
    route: '/api/documents/[id]/edits/resolve-all',
    mode,
    count: pending.length,
  })
  if (!audit.ok) {
    return NextResponse.json({ error: 'Audit log write failed; access denied', code: 'audit_failed' }, { status: 503 })
  }

  const version = await loadActiveVersion(sb, id)
  if (!version) return NextResponse.json({ error: 'No active version' }, { status: 404 })

  const wIds = pending
    .flatMap(e => [e.del_w_id, e.ins_w_id])
    .filter((w): w is string => Boolean(w))

  const bytes = await loadR2Bytes(version.r2_key)
  const resolved = await resolveTrackedChange(bytes, wIds, mode)

  await putFileToR2(version.r2_key, resolved.bytes, DOCX_CONTENT_TYPE)
  await sb
    .from('matter_documents')
    .update({ size: resolved.bytes.byteLength, r2_key: version.r2_key })
    .eq('id', id)

  const now = new Date().toISOString()
  const { error } = await sb
    .from('document_edits')
    .update({
      status: mode === 'accept' ? 'accepted' : 'rejected',
      resolved_at: now,
      resolved_by: user.id,
    })
    .eq('document_id', id)
    .eq('status', 'pending')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    resolved: pending.length,
    remaining_pending: 0,
    found: resolved.found,
  })
}
