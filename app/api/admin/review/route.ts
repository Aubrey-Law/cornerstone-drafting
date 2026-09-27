import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { readReviewUpload } from '@/lib/review/upload'
import { reviewClient } from '@/lib/review/staff'
import { startReview } from '@/lib/review/startReview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Extracting a large PDF's text layer is the slow part; no model call happens here.
export const maxDuration = 60

/**
 * POST /api/admin/review — start a review (multipart form).
 *
 * `playbookSlug` and either `documentVersionId` (a current document on a
 * hired matter) or `document` (a PDF or DOCX file, with an optional `label`).
 * Answers with the queued run's id; the saved-review page shows it filling in.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form body' }, { status: 400 })
  }
  const playbookSlug = String(form.get('playbookSlug') ?? '').trim()
  if (!playbookSlug) return NextResponse.json({ error: 'Choose a playbook to run.' }, { status: 400 })

  const documentVersionId = String(form.get('documentVersionId') ?? '').trim()
  let subject: Parameters<typeof startReview>[1]['subject']
  if (documentVersionId) {
    subject = { documentVersionId }
  } else {
    const upload = await readReviewUpload(form)
    if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })
    subject = { upload: { bytes: upload.bytes, filename: upload.filename, label: String(form.get('label') ?? '') } }
  }

  const result = await startReview(reviewClient(), { subject, playbookSlug, userId: auth.userId! })
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return NextResponse.json({ runId: result.runId, matterId: result.matterId, reviewUploadId: result.reviewUploadId })
}
