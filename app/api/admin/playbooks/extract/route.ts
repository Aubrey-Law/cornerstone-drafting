import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic } from '@/lib/anthropic'
import { buildLayer, extractorFor } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'
import { extractCandidateRules } from '@aubrey-law/citations/playbookBuilder/extractRules'
import type { ModelCaller } from '@aubrey-law/citations/review/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/playbooks/extract
 *
 * Reads an uploaded precedent and proposes review rules from it. Ported from
 * the workbench's `/api/staff/playbooks/extract`.
 *
 * Proposes only. Nothing is written here: the candidates go back to the
 * builder, where an attorney edits and approves them, and publishing is a
 * separate action (`app/admin/playbooks/actions.ts`). The precedent itself is
 * not stored either — it is the firm's own form, read once for its positions.
 *
 * The same upload rules as a review (`readReviewUpload`): PDF or DOCX only, and
 * the same size cap, because extraction holds the whole document in memory.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth.err) return auth.err

  const form = await request.formData()
  const upload = await readReviewUpload(form)
  if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })

  const documentType = String(form.get('documentType') ?? '').trim().slice(0, 80) || null

  // Checked here rather than left to the SDK, which would answer a missing key
  // with a 401 that reads like the attorney's fault.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not set, so rules cannot be proposed. Set it on this app’s environment.' },
      { status: 503 },
    )
  }
  const callModel: ModelCaller = (modelRequest, context) => callAnthropic(modelRequest, context)

  try {
    const kind = extractorFor(upload.filename)
    if (!kind) throw new Error(`${upload.filename} is not a PDF or a DOCX.`)
    const layer = await buildLayer(upload.bytes, kind)
    const result = await extractCandidateRules(layer, {
      callModel,
      userId: auth.userId,
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
