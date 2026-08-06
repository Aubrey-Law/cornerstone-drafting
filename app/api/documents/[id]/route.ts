import { NextResponse, after } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { auditDocumentAccess, isAdminUser, userCanReadDocument } from '@/lib/documentSecurity'
import { notifyClientOfSharedDocument } from '@/lib/portalNotifications'

// GET /api/documents/[id]  →  { url: signedDownloadUrl, document: MatterDocument }
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
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

  const r2 = getR2Client()
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }),
    { expiresIn: 300 },
  )
  return NextResponse.json({ url, document: doc })
}

// PATCH /api/documents/[id]
//
// Three modes, all attorney-only:
//   { shared: boolean }   toggle client visibility
//   { name: string }      rename
//   { reviewed: boolean } informational review marker (gates nothing)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { shared, reviewed, name } = (await req.json()) as {
    shared?: boolean
    reviewed?: boolean
    name?: string
  }

  const isShareToggle = typeof shared === 'boolean'
  const isReviewToggle = typeof reviewed === 'boolean'
  const isRename = typeof name === 'string'
  if (!isShareToggle && !isReviewToggle && !isRename) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing, error: loadError } = await sb
    .from('matter_documents')
    .select('id, matter_id, name, shared_at')
    .eq('id', id)
    .single()
  if (loadError || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isShareToggle) {
    const wasShared = existing.shared_at !== null
    const { data, error: shareErr } = await sb
      .from('matter_documents')
      .update({ shared_at: shared ? new Date().toISOString() : null })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (shareErr) return NextResponse.json({ error: shareErr.message }, { status: 500 })

    await auditDocumentAccess(sb, user, data, shared ? 'share' : 'unshare', {
      document_name: data.name,
    })

    if (shared && !wasShared) {
      after(() => notifyClientOfSharedDocument(data.matter_id, data.name))
    }
    return NextResponse.json({ document: data })
  }

  if (isReviewToggle) {
    const { data, error: reviewErr } = await sb
      .from('matter_documents')
      .update({
        reviewed_at: reviewed ? new Date().toISOString() : null,
        reviewed_by: reviewed ? user.id : null,
      })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 })

    await auditDocumentAccess(sb, user, data, 'review', { reviewed, document_name: data.name })
    return NextResponse.json({ document: data })
  }

  const trimmed = (name ?? '').trim()
  if (!trimmed) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (trimmed === existing.name) return NextResponse.json({ document: existing })

  const { data, error: renameErr } = await sb
    .from('matter_documents')
    .update({ name: trimmed })
    .eq('id', id)
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()
  if (renameErr) return NextResponse.json({ error: renameErr.message }, { status: 500 })

  await auditDocumentAccess(sb, user, data, 'rename', {
    previous_name: existing.name,
    document_name: trimmed,
  })
  return NextResponse.json({ document: data })
}

// DELETE /api/documents/[id]  →  audit, delete DB row, then best-effort R2 delete
//
// Order matters: the DB row goes first so a partial failure leaves an orphaned
// R2 object (invisible to the app, costs only storage) rather than a ghost row
// pointing at nothing.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditDocumentAccess(sb, user, doc, 'delete', {
    document_name: doc.name,
    r2_key: doc.r2_key,
    was_shared: doc.shared_at !== null,
  })

  const { error: dbError } = await sb.from('matter_documents').delete().eq('id', id)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  const r2 = getR2Client()
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }))
  } catch (e) {
    console.error('R2 delete error (object orphaned, will need GC):', e)
  }

  return NextResponse.json({ ok: true })
}
