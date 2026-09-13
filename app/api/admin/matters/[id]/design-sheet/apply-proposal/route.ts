import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { applyDesignSheetProposal } from '@/lib/designSheet/applyProposal'
import type { ResolvedFiduciaryProposal } from '@/lib/designSheet/fiduciaryProposal'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ApplyProposalBody {
  sheetId?: string | null
  expectedUpdatedAt?: string | null
  /** Accepted field values, keyed by column name or `<namespace>.<key>`. */
  fields?: Record<string, unknown>
  /** Accepted fiduciary rows, exactly as the review dialog listed them. */
  fiduciaries?: ResolvedFiduciaryProposal[]
}

/**
 * Save an accepted proposal.
 *
 * The work itself lives in `lib/designSheet/applyProposal.ts`, because the Word
 * add-in accepts proposals too and the design sheet must have exactly one
 * writer. This route is the web dialog's entry to it: auth, body shape, and the
 * JSON the dialog already reads.
 *
 * The generic design-sheet PATCH still cannot do this job — a decision field has
 * to be folded into its `decisions` namespace, and a fiduciary may have to mint a
 * `contacts` row before there is an id to store.
 */
export async function POST(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as ApplyProposalBody | null

  try {
    const result = await applyDesignSheetProposal({
      matterId,
      sheetId: body?.sheetId ?? null,
      expectedUpdatedAt: body?.expectedUpdatedAt ?? null,
      fields: body?.fields && typeof body.fields === 'object' ? body.fields : {},
      fiduciaries: Array.isArray(body?.fiduciaries) ? body.fiduciaries : [],
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.conflict ? { conflict: true } : {}),
          ...(result.updatedAt ? { updated_at: result.updatedAt } : {}),
        },
        { status: result.status },
      )
    }

    return NextResponse.json({
      ok: true,
      id: result.id,
      updated_at: result.updatedAt,
      applied_fields: result.appliedFields,
      applied_fiduciaries: result.appliedFiduciaries,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to apply design sheet proposal'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
