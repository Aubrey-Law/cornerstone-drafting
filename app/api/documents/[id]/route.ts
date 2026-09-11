import { NextResponse, after } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getR2Client, r2Bucket } from '@/lib/r2'
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { auditDocumentAccess, isAdminUser, userCanReadDocument } from '@/lib/documentSecurity'
import { notifyClientOfSharedDocument } from '@/lib/portalNotifications'
import { documentReviewRevision } from '@/lib/documents/reviewRevision'
import { checkDocumentShareable, describeShareBlock } from '@/lib/documents/shareGate'

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
    new GetObjectCommand({ Bucket: r2Bucket(), Key: doc.r2_key }),
    { expiresIn: 300 },
  )
  return NextResponse.json({ url, document: doc, reviewRevision: documentReviewRevision(doc) })
}

// PATCH /api/documents/[id]
//
// Four modes, all attorney-only:
//   { shared: boolean }            toggle client visibility
//   { name: string }               rename
//   { reviewed: boolean }          informational review marker (gates nothing)
//   { folderId: string | null }    move into an attorney-created folder, or back
//                                  to the root of the workspace with null
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json()) as {
    shared?: boolean
    reviewed?: boolean
    reviewRevision?: string
    name?: string
    folderId?: string | null
  }
  const { shared, reviewed, name } = body

  const isShareToggle = typeof shared === 'boolean'
  const isReviewToggle = typeof reviewed === 'boolean'
  const isRename = typeof name === 'string'
  // `null` is the meaningful "move to root" value, so presence of the key —
  // not truthiness — is what selects this mode.
  const isMove = 'folderId' in body && (typeof body.folderId === 'string' || body.folderId === null)
  if (!isShareToggle && !isReviewToggle && !isRename && !isMove) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing, error: loadError } = await sb
    .from('matter_documents')
    // r2_key, content_type, source and missing_count are here for the share
    // gate, which reads the bytes a client would actually download.
    .select('id, matter_id, name, shared_at, r2_key, content_type, source, missing_count, current_version_id, superseded_at')
    .eq('id', id)
    .single()
  if (loadError || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isMove) {
    const folderId = body.folderId ?? null
    if (folderId) {
      // A folder belongs to one matter; moving a document across matters with
      // it would quietly relocate the file.
      const { data: folder } = await sb
        .from('matter_document_folders')
        .select('id, matter_id, name')
        .eq('id', folderId)
        .maybeSingle()
      if (!folder || folder.matter_id !== existing.matter_id) {
        return NextResponse.json({ error: 'Folder not found for this matter' }, { status: 404 })
      }
    }

    const { data, error: moveErr } = await sb
      .from('matter_documents')
      .update({ folder_id: folderId })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 })

    return NextResponse.json({ document: data })
  }

  if (isShareToggle) {
    const wasShared = existing.shared_at !== null

    // Checked only on the way *out*. Unsharing must always work — it is how a
    // document that should not have gone out is pulled back, and gating that
    // would be exactly backwards.
    if (shared) {
      const check = await checkDocumentShareable(existing)
      if (!check.shareable) {
        return NextResponse.json(
          {
            error: describeShareBlock(check),
            reason: check.reason,
            missingFields: check.reason === 'missing_fields' ? check.missingFields : undefined,
          },
          { status: 409 },
        )
      }
    }

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
    if (existing.superseded_at || body.reviewRevision !== documentReviewRevision(existing)) {
      return NextResponse.json({ error: 'This document changed. Open the current version before marking it reviewed.' }, { status: 409 })
    }
    const update = sb
      .from('matter_documents')
      .update({
        reviewed_at: reviewed ? new Date().toISOString() : null,
        reviewed_by: reviewed ? user.id : null,
      })
      .eq('id', id)
      .eq('r2_key', existing.r2_key)
      .is('superseded_at', null)
    const guarded = existing.current_version_id
      ? update.eq('current_version_id', existing.current_version_id)
      : update.is('current_version_id', null)
    const { data, error: reviewErr } = await guarded.select(MATTER_DOCUMENT_COLUMNS).maybeSingle()
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'This document changed while you were reviewing it. Reload the current version.' }, { status: 409 })

    await auditDocumentAccess(sb, user, data, 'review', { reviewed, document_name: data.name, version_id: existing.current_version_id, review_revision: body.reviewRevision })
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
    await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: doc.r2_key }))
  } catch (e) {
    console.error('R2 delete error (object orphaned, will need GC):', e)
  }

  return NextResponse.json({ ok: true })
}
