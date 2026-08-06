import { NextResponse } from 'next/server'
import { auditDocumentAccess, isAdminUser } from '@/lib/documentSecurity'
import { DOCX_CONTENT_TYPE, getDocumentApiUser, loadR2Bytes } from '@/lib/documentApiHelpers'
import { resolveTrackedChange } from '@/lib/docxTrackedChanges'
import { loadActiveVersion } from '@/lib/documentVersions'
import { putFileToR2 } from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Mode = 'accept' | 'reject'

export async function resolveEdit(
  req: Request,
  params: Promise<{ id: string; editId: string }>,
  mode: Mode,
) {
  const user = await getDocumentApiUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, editId } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: doc } = await sb.from('matter_documents').select(MATTER_DOCUMENT_COLUMNS).eq('id', id).single()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: edit } = await sb
    .from('document_edits')
    .select('*')
    .eq('id', editId)
    .eq('document_id', id)
    .maybeSingle()
  if (!edit) return NextResponse.json({ error: 'Edit not found' }, { status: 404 })

  if (edit.status !== 'pending') {
    const { count } = await sb
      .from('document_edits')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', id)
      .eq('status', 'pending')
    return NextResponse.json({ edit, remaining_pending: count ?? 0, already_resolved: true })
  }

  await auditDocumentAccess(sb, user, doc, 'edit', {
    route: `/api/documents/[id]/edits/[editId]/${mode}`,
    edit_id: editId,
  })

  const version = await loadActiveVersion(sb, id)
  if (!version) return NextResponse.json({ error: 'No active version' }, { status: 404 })

  const bytes = await loadR2Bytes(version.r2_key)
  const wIds = [edit.del_w_id, edit.ins_w_id].filter(Boolean) as string[]
  const resolved = await resolveTrackedChange(bytes, wIds, mode)

  await putFileToR2(version.r2_key, resolved.bytes, DOCX_CONTENT_TYPE)
  await sb
    .from('matter_documents')
    .update({ size: resolved.bytes.byteLength, r2_key: version.r2_key })
    .eq('id', id)

  const now = new Date().toISOString()
  const { data: updated, error } = await sb
    .from('document_edits')
    .update({
      status: mode === 'accept' ? 'accepted' : 'rejected',
      resolved_at: now,
      resolved_by: user.id,
    })
    .eq('id', editId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { count } = await sb
    .from('document_edits')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', id)
    .eq('status', 'pending')

  return NextResponse.json({
    edit: updated,
    remaining_pending: count ?? 0,
    found: resolved.found,
  })
}
