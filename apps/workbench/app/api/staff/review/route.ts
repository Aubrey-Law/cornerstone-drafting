import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { requireStaff } from '@/lib/auth/requireStaff'
import { loadReviewPlaybook } from '@/lib/review/playbook'
import { loadReviewableByMatter, resolveReviewableDocument } from '@/lib/review/matterDocuments'
import { runDocumentReview } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'
import { readObject } from '@/lib/storage/r2'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Runs one review playbook against one uploaded document.
 *
 * Two ways in. A `documentVersionId` names a document already filed on a
 * matter, which is the normal case now that every draft reviewed here is the
 * firm's own: it gives the review a real `document_versions.id` to anchor
 * citations to, which an ad-hoc upload cannot. An uploaded file still works,
 * for a draft not yet filed.
 *
 * The client sends an id, never a storage key. A key from the browser would be
 * an arbitrary read against the bucket holding every client's documents.
 *
 * Nothing is stored yet. The run and its findings are the next piece; this is
 * what makes them anchorable.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const form = await request.formData()
  const documentVersionId = String(form.get('documentVersionId') ?? '').trim()

  let bytes: Buffer
  let filename: string
  let anchor: { documentVersionId: string; documentId: string; matterId: string } | null = null

  if (documentVersionId) {
    const resolved = resolveReviewableDocument(
      await loadReviewableByMatter(getAdminClient()),
      documentVersionId,
    )
    if (!resolved) {
      return NextResponse.json(
        { error: 'That document is not one of the current, citable documents on a hired matter.' },
        { status: 404 },
      )
    }
    try {
      bytes = await readObject(resolved.source.key)
    } catch (error) {
      return NextResponse.json(
        { error: `Could not read ${resolved.name} from storage: ${error instanceof Error ? error.message : 'unknown error'}` },
        { status: 502 },
      )
    }
    filename = resolved.name
    anchor = {
      documentVersionId: resolved.versionId,
      documentId: resolved.documentId,
      matterId: resolved.matterId,
    }
  } else {
    const upload = await readReviewUpload(form)
    if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })
    bytes = upload.bytes
    filename = upload.filename
  }

  let callModel
  try {
    callModel = anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) {
      // 503 rather than 500: the app is fine, this feature is not configured.
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }

  const playbook = loadReviewPlaybook()

  try {
    const { layer, result } = await runDocumentReview(bytes, filename, playbook, {
      callModel,
      userId: auth.user.id,
    })
    return NextResponse.json({
      filename,
      anchor,
      playbook: { slug: playbook.slug, title: playbook.title, version: playbook.version },
      layer,
      result,
    })
  } catch (error) {
    // A scan, or an unreadable file. Both are the caller's to fix, and both
    // deserve the real reason rather than a generic failure.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The review could not be run.' },
      { status: 422 },
    )
  }
}
