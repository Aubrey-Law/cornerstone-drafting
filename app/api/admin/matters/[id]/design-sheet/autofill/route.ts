import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveLlmConfig } from '@/lib/llm'
import { parseUserPreferences } from '@/lib/userPreferences'
import { buildCompletionContext } from '@/lib/designSheetCompletion/context'
import { resolveWithoutAi } from '@/lib/designSheetCompletion/deterministic'
import {
  proposeDesignSheetCompletion,
  type CompletionSource,
} from '@/lib/designSheetCompletion/engine'
import {
  buildDesignSheetImportPreview,
  getDesignSheetImportTextValidationError,
} from '@/lib/designSheetImport/shared'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Propose values for everything the design sheet is still missing.
 *
 * Proposes only. Nothing here writes to `design_sheets` — the attorney accepts
 * per field in the review dialog, and `apply-proposal` does the saving. Keeping
 * the split means an autofill run can never surprise anyone with a saved value,
 * which is the whole basis for letting a model near a drafting worksheet.
 *
 * The deterministic pass runs first and its answers are merged into the same
 * review list, so a field the firm's own standards can settle never reaches a
 * prompt and never costs a token.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params

  const body = await req.json().catch(() => null) as { source?: string; text?: unknown } | null
  const rawText = typeof body?.text === 'string' ? body.text.trim() : ''

  let source: CompletionSource = { kind: 'blockers' }
  if (body?.source === 'text' || rawText) {
    const validationError = getDesignSheetImportTextValidationError(rawText)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
    source = { kind: 'text', text: rawText }
  }

  try {
    const admin = getAdminClient()
    const context = await buildCompletionContext(matterId)

    const { data: profile } = await admin
      .from('users')
      .select('preferences')
      .eq('id', userId)
      .maybeSingle()
    const attorneyPreset = parseUserPreferences(profile?.preferences).drafting?.attorneyPreset ?? null

    const deterministic = resolveWithoutAi({
      sheet: context.sheet,
      matter: context.matter,
      attorneyPreset,
    })

    const llm = await resolveLlmConfig(admin, userId)
    if (!llm.ok) return NextResponse.json({ error: llm.error }, { status: 400 })

    const ai = await proposeDesignSheetCompletion({
      config: llm.config,
      context,
      source,
      alreadyResolved: Object.keys(deterministic.patch),
    })

    // Deterministic answers are proposals too. They lead the list because they
    // are exact, and each carries why it was filled so the row is auditable.
    const deterministicPreview = buildDesignSheetImportPreview({
      currentSheet: context.sheet as unknown as Record<string, unknown>,
      proposed: deterministic.patch as Record<string, unknown>,
    }).map(row => ({ ...row, source: deterministic.sources[row.field] ?? 'computed' }))

    const proposed = { ...deterministic.patch, ...ai.proposed }

    return NextResponse.json({
      ok: true,
      proposed,
      preview: [...deterministicPreview, ...ai.preview],
      rejected: ai.rejected,
      fiduciaries: ai.fiduciaries,
      blocking_count: context.blocking.length,
    })
  } catch (error) {
    console.error('design-sheet autofill error:', error)
    const message = error instanceof Error ? error.message : 'Unable to build design sheet proposal'
    const status = message.startsWith('AI ') ? 502 : message.includes('no design sheet') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
