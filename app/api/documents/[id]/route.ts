import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import {
  auditDocumentAccess,
  isAdminUser,
  userCanReadDocument,
} from '@/lib/documentSecurity'
import { wordDocShareBlockReason } from '@/lib/documentSharing'

async function getUser(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user ?? null
}

// GET /api/documents/[id]  →  { url: signedDownloadUrl, document: MatterDocument }
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const action = new URL(req.url).searchParams.get('action') === 'view' ? 'view' : 'download'
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

  const audit = await auditDocumentAccess(sb, user, doc, action, { route: '/api/documents/[id]' })
  if (!audit.ok) {
    return NextResponse.json(
      { error: 'Audit log write failed; access denied', code: 'audit_failed' },
      { status: 503 },
    )
  }

  const r2 = getR2Client()
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }),
    { expiresIn: 300 },
  )
  return NextResponse.json({ url, document: doc })
}

const VALID_FOLDERS = ['draft', 'final', 'client', 'review', 'signed', 'intake', 'meeting-notes'] as const
type DocFolder = (typeof VALID_FOLDERS)[number]
const CLIENT_VISIBLE_FOLDERS: ReadonlySet<DocFolder> = new Set(['review', 'signed', 'final', 'intake', 'client'])
// Folders that are internal-only and therefore require the attorney-review
// confirmation modal before being promoted to any client-visible folder.
const INTERNAL_SOURCE_FOLDERS: ReadonlySet<DocFolder> = new Set(['draft', 'meeting-notes'])

// PATCH /api/documents/[id]  →  update folder (e.g. draft → review to share with client)
//
// Every folder change is logged to document_access_audit with the prior and
// new folder so attorneys can prove which documents were promoted to client
// visibility and when. If the audit row cannot be written the update is
// rolled back and the request fails — promotion without an audit trail is
// not allowed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { folder, confirmed, reviewed, name } = (await req.json()) as {
    folder?: string
    confirmed?: boolean
    reviewed?: boolean
    name?: string
  }
  // Three PATCH modes: a folder change, an attorney review-state toggle
  // (`reviewed` with no folder), or a rename (`name` with no folder/review).
  // The review toggle records sign-off that the promote gate below requires
  // before a draft can become client-visible.
  const isReviewToggle = folder === undefined && typeof reviewed === 'boolean'
  const isRename = folder === undefined && reviewed === undefined && typeof name === 'string'
  if (!isReviewToggle && !isRename) {
    if (!folder) return NextResponse.json({ error: 'folder is required' }, { status: 400 })
    if (!VALID_FOLDERS.includes(folder as DocFolder)) {
      return NextResponse.json({ error: `Invalid folder: ${folder}` }, { status: 400 })
    }
  }

  const sb = getAdminClient()
  if (!(await isAdminUser(sb, user))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: existing, error: loadError } = await sb
    .from('matter_documents')
    .select('id, matter_id, folder, name, marker_count, reviewed_at, reviewed_by')
    .eq('id', id)
    .single()
  if (loadError || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Review-state toggle: set/clear reviewed_at + reviewed_by, audited as 'review'.
  if (isReviewToggle) {
    const reviewedAt = reviewed ? new Date().toISOString() : null
    const reviewedBy = reviewed ? user.id : null
    const { data, error: reviewErr } = await sb
      .from('matter_documents')
      .update({ reviewed_at: reviewedAt, reviewed_by: reviewedBy })
      .eq('id', id)
      .select(MATTER_DOCUMENT_COLUMNS)
      .single()
    if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 })

    const audit = await auditDocumentAccess(sb, user, data, 'review', {
      reviewed,
      document_name: data.name,
      route: '/api/documents/[id] PATCH (review)',
    })
    if (!audit.ok) {
      await sb
        .from('matter_documents')
        .update({ reviewed_at: existing.reviewed_at, reviewed_by: existing.reviewed_by })
        .eq('id', id)
      return NextResponse.json({ error: 'Audit log write failed; review change reverted' }, { status: 500 })
    }
    return NextResponse.json({ document: data })
  }

  // Rename: update the document's display name, audited as 'rename' with the
  // prior name. Reverts the change if the audit row can't be written.
  if (isRename) {
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

    const audit = await auditDocumentAccess(sb, user, data, 'rename', {
      previous_name: existing.name,
      document_name: trimmed,
      route: '/api/documents/[id] PATCH (rename)',
    })
    if (!audit.ok) {
      await sb.from('matter_documents').update({ name: existing.name }).eq('id', id)
      return NextResponse.json({ error: 'Audit log write failed; rename reverted' }, { status: 500 })
    }
    return NextResponse.json({ document: data })
  }

  if (existing.folder === folder) {
    return NextResponse.json({ document: existing })
  }

  const fromFolder = existing.folder as DocFolder
  const toFolder = folder as DocFolder
  const promotionToClientVisible =
    INTERNAL_SOURCE_FOLDERS.has(fromFolder) && CLIENT_VISIBLE_FOLDERS.has(toFolder)

  const shareBlock = wordDocShareBlockReason(
    existing.name,
    (existing as { content_type?: string | null }).content_type,
    toFolder,
  )
  if (shareBlock) {
    return NextResponse.json(
      { error: shareBlock, code: 'word_doc_not_shareable' },
      { status: 409 },
    )
  }

  // Server-side review-gate: any move from an internal-only folder
  // (draft, meeting-notes) to a client-visible folder requires an explicit
  // confirmation flag. The UI shows a modal that posts confirmed=true; a
  // hand-crafted PATCH without the flag is rejected.
  if (promotionToClientVisible && confirmed !== true) {
    return NextResponse.json(
      { error: 'Promoting an internal document to client-visible requires explicit confirmation', code: 'promotion_not_confirmed' },
      { status: 409 },
    )
  }

  // Hard marker gate removed — attorneys may email or share any document.
  // Review tracking is separate from portal visibility (see reviewed PATCH).

  const updatePayload: { folder: DocFolder } = { folder: toFolder }

  const { data, error } = await sb
    .from('matter_documents')
    .update(updatePayload)
    .eq('id', id)
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const audit = await auditDocumentAccess(sb, user, data, 'folder_change', {
    from_folder: fromFolder,
    to_folder: toFolder,
    promotion_to_client_visible: promotionToClientVisible,
    confirmation_flag: confirmed === true,
    document_name: data.name,
    route: '/api/documents/[id] PATCH',
  })

  if (!audit.ok) {
    // Compensating revert — restore the prior folder so we don't end up with a
    // client-visible document and no audit trail.
    await sb.from('matter_documents').update({ folder: fromFolder }).eq('id', id)
    return NextResponse.json(
      { error: 'Audit log write failed; folder change reverted' },
      { status: 500 },
    )
  }

  return NextResponse.json({ document: data })
}

// DELETE /api/documents/[id]  →  audit, delete DB row, then best-effort R2 delete
//
// Order matters. The previous implementation deleted from R2 first and ignored
// errors, which silently orphaned client-visible "ghost" rows on R2 success +
// DB failure. We now write the audit row first, delete the DB row second, and
// schedule the R2 cleanup last (any remaining R2 object is invisible to the
// app and only costs storage).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req)
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

  const audit = await auditDocumentAccess(sb, user, doc, 'delete', {
    folder: doc.folder,
    r2_key: doc.r2_key,
    document_name: doc.name,
    route: '/api/documents/[id] DELETE',
  })
  if (!audit.ok) {
    return NextResponse.json(
      { error: 'Audit log write failed; deletion aborted' },
      { status: 500 },
    )
  }

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
