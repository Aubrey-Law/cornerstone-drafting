import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { requireStaff } from '@/lib/auth/requireStaff'
import { buildLayer, extractorFor } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'
import { extractCandidateRules } from '@aubrey-law/citations/playbookBuilder/extractRules'

/**
 * Reads an uploaded precedent and proposes review rules from it.
 *
 * Proposes only. Nothing is written here: the candidates go back to the
 * builder, where an attorney edits and approves them, and publishing is a
 * separate action (`app/playbooks/actions.ts`). The precedent itself is not
 * stored either — it is the firm's own form, read once for its positions.
 *
 * The same upload rules as a review (`readReviewUpload`): PDF or DOCX only, and
 * the same size cap, because extraction holds the whole document in memory.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const form = await request.formData()
  const upload = await readReviewUpload(form)
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })

  const documentType = String(form.get('documentType') ?? '').trim().slice(0, 80) || null

  let callModel
  try {
    callModel = anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }

  try {
    const kind = extractorFor(upload.filename)
    if (!kind) throw new Error(`${upload.filename} is not a PDF or a DOCX.`)
    const layer = await buildLayer(upload.bytes, kind)
    const result = await extractCandidateRules(layer, {
      callModel,
      userId: auth.user.id,
      documentType,
    })

    return NextResponse.json({
      filename: upload.filename,
      paragraphCount: layer.blocks.length,
      ...result,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The precedent could not be read.' },
      { status: 422 },
    )
  }
}
