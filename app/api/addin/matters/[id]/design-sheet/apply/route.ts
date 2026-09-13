import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  applyDesignSheetProposal,
  partitionImportableFields,
} from '@/lib/designSheet/applyProposal'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ApplyBody {
  sheetId?: string | null
  expectedUpdatedAt?: string | null
  /** Only the rows the attorney ticked, keyed as the preview listed them. */
  fields?: Record<string, unknown>
}

/**
 * Write the accepted rows back to the design sheet.
 *
 * Delegates to the one writer, `applyDesignSheetProposal` — the same call the web
 * review dialog makes. The compare-and-swap, the decision-namespace routing and
 * the empty-decisions guard all live there precisely so this route cannot get a
 * different answer to any of them.
 *
 * Two things this route adds on its own, both because the pane is further from
 * the attorney's eye than the dialog is:
 *
 *   - **Fields are allow-listed** against `DESIGN_SHEET_IMPORT_FIELDS`. Only what
 *     the extractor can propose may be applied, so a malformed or hostile body
 *     cannot reach a column the review UI never showed anyone.
 *   - **No fiduciary proposals.** The writer supports them, and accepting one can
 *     mint a `contacts` row — creating a person in the firm's records from a Word
 *     pane, without the matching UI the dialog has, is not something to do
 *     sight-unseen. Fiduciary *names* still write back: they are ordinary
 *     allow-listed string fields (`trustee_primary`, `guardian_primary`, …).
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as ApplyBody | null

  const requested = body?.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
    ? body.fields
    : {}

  const { fields, refused } = partitionImportableFields(requested)

  if (refused.length > 0) {
    return NextResponse.json(
      { error: `Not design-sheet fields: ${refused.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const result = await applyDesignSheetProposal({
      matterId,
      sheetId: body?.sheetId ?? null,
      expectedUpdatedAt: body?.expectedUpdatedAt ?? null,
      fields,
      fiduciaries: [],
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.conflict
            ? 'The design sheet changed while you were reviewing. Re-read it and run this again.'
            : result.error,
          ...(result.conflict ? { conflict: true } : {}),
        },
        { status: result.status },
      )
    }

    return NextResponse.json({
      ok: true,
      updatedAt: result.updatedAt,
      appliedFields: result.appliedFields,
    })
  } catch (error) {
    console.error('[addin/design-sheet/apply]', error)
    const message = error instanceof Error ? error.message : 'Could not save to the design sheet'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
