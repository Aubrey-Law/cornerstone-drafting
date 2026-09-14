import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { DOCX_CONTENT_TYPE, isDocxDocument } from '@/lib/documentApiHelpers'
import { auditDocumentAccess } from '@/lib/documentSecurity'
import {
  createDocumentVersion,
  ensureInitialVersion,
  listDocumentVersions,
  loadActiveVersion,
} from '@/lib/documentVersions'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

/**
 * Base64 inflates by 4/3 and Vercel caps the request body. Mirrored in the
 * pane by `MAX_UPLOAD_BASE64_CHARS`, which checks before spending the upload.
 */
const MAX_BASE64_CHARS = 4_400_000

/** GET — the document's version history, for the pane to show what it is joining. */
export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const admin = getAdminClient()

  const { data: doc, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const versions = await listDocumentVersions(admin, id).catch(() => [])
  return NextResponse.json(
    {
      documentId: id,
      name: doc.name,
      currentVersionId: doc.current_version_id ?? null,
      versions: versions.map(v => ({
        id: v.id,
        versionNumber: v.version_number,
        source: v.source,
        sizeBytes: v.size_bytes,
        createdAt: v.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * POST — save the open Word document as the document's next version.
 *
 * This is what closes the gap the add-in shipped with: the pane edited whatever
 * file was open on disk, while `/api/documents/[id]/edits` wrote R2 versions,
 * and the two never met. An attorney's tracked changes lived only in a local
 * file, and the firm's record did not know they existed.
 *
 * The bytes are the attorney's own document, uploaded whole, rather than the
 * pane's edit list replayed server-side. Replaying would produce a *different*
 * document from the one they are looking at — Word's revisions and the server's
 * applier do not agree at the XML level — so the file on their screen would
 * stop being the file of record.
 *
 * `ensureInitialVersion` runs first, so the state before the pane touched
 * anything becomes v1 and this save becomes v2. Without it the history would
 * begin at the edited document and the original would be unrecoverable.
 *
 * Recorded as `word_addin`, which 20261130000000 added to the
 * `document_versions.source` CHECK. It was `user_upload` first, and that read
 * in the version history exactly like a document dragged into the browser —
 * true in the letter, wrong about what happened. The audit row still carries
 * `surface: 'word-addin'`, because "who did this and from where" is what the
 * audit table is for; the source column is what the version list shows.
 *
 * No `document_edits` rows. Those carry the `w:id` of each revision so the web
 * UI can accept or reject one, and the pane cannot know the ids Word assigned.
 * A row without them is worse than no row: `resolveTrackedChange` would get an
 * empty id list, change nothing, and still mark the edit accepted. The pane's
 * own cards accept and reject in Word, which is where these revisions are.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    fileBase64?: unknown
    baseVersionId?: unknown
  } | null

  const fileBase64 = typeof body?.fileBase64 === 'string' ? body.fileBase64 : ''
  if (!fileBase64) {
    return NextResponse.json({ error: 'fileBase64 is required' }, { status: 400 })
  }
  if (fileBase64.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: 'Document too large to save from the pane' }, { status: 413 })
  }

  const admin = getAdminClient()
  const { data: doc, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isDocxDocument(doc)) {
    return NextResponse.json({ error: 'Only DOCX documents carry versions' }, { status: 415 })
  }

  try {
    await ensureInitialVersion({
      admin,
      documentId: id,
      r2Key: doc.r2_key,
      filename: doc.name,
      contentType: doc.content_type || DOCX_CONTENT_TYPE,
      sizeBytes: doc.size,
      source: doc.generation_id ? 'generated' : 'upload',
      createdBy: userId,
    })

    /*
     * Refuse to supersede a version the attorney never saw.
     *
     * They may have been editing in Word for an hour while someone saved a new
     * version in the web app. Uploading over it would discard that work with no
     * trace — the failure this whole path exists to prevent, arriving by a
     * different door.
     *
     * This catches a version created since the document was linked in the pane.
     * It cannot catch an attorney who opened a stale download and never linked
     * it, because nothing in the file says which version it came from.
     */
    const active = await loadActiveVersion(admin, id)
    const baseVersionId = typeof body?.baseVersionId === 'string' ? body.baseVersionId : null
    if (baseVersionId && active && active.id !== baseVersionId) {
      return NextResponse.json(
        {
          error: `Version ${active.version_number} was saved by someone else while you were editing. Compare before saving over it.`,
          conflict: true,
          currentVersionId: active.id,
          currentVersionNumber: active.version_number,
        },
        { status: 409 },
      )
    }

    const bytes = Buffer.from(fileBase64, 'base64')
    const scan = scanDocxBufferForMarkers(bytes)

    const result = await createDocumentVersion({
      admin,
      documentId: id,
      matterId: doc.matter_id,
      bytes,
      filename: doc.name,
      contentType: DOCX_CONTENT_TYPE,
      source: 'word_addin',
      createdBy: userId,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // Matches the edits route: the counts describe the current bytes, and a
    // stale marker count is how a draft looks finished when it is not.
    await admin
      .from('matter_documents')
      .update({ marker_count: scan.markerCount, missing_count: scan.missingFields.length })
      .eq('id', id)

    await auditDocumentAccess(
      admin,
      { id: userId, email: auth.user?.email },
      doc,
      'edit',
      { route: '/api/addin/documents/[id]/versions', surface: 'word-addin' },
    )

    return NextResponse.json({
      ok: true,
      versionId: result.version.id,
      versionNumber: result.version.version_number,
      markerCount: scan.markerCount,
      missingCount: scan.missingFields.length,
    })
  } catch (err) {
    console.error('[addin/documents/versions]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save the version' },
      { status: 500 },
    )
  }
}
