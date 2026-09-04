import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { requireStaff } from '@/lib/auth/requireStaff'
import { loadReviewPlaybook } from '@/lib/review/playbook'
import { runDocumentReview } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'

/**
 * Runs one review playbook against one uploaded document.
 *
 * Nothing is stored. The document is read, extracted, reviewed and the result
 * handed back — it never touches a matter, which is what lets an attorney point
 * this at an opposing counsel's draft before deciding anything about it.
 *
 * That is also this route's main limitation, and it is a decision waiting to be
 * taken rather than an oversight: where a third-party draft belongs once
 * reviewed — filed against the matter, or held apart from it — governs the
 * schema for saved runs.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const upload = await readReviewUpload(await request.formData())
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })

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
    const { layer, result } = await runDocumentReview(upload.bytes, upload.filename, playbook, {
      callModel,
      userId: auth.user.id,
    })
    return NextResponse.json({
      filename: upload.filename,
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
