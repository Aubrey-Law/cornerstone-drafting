import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'
import { buildClausePreviews } from '@/lib/estateGenerator/clausePreview'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import type { DesignSheet } from '@/types/database'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { sheet?: Partial<DesignSheet> } | null
  if (!body?.sheet || typeof body.sheet !== 'object' || Array.isArray(body.sheet)) {
    return NextResponse.json({ error: 'sheet is required' }, { status: 400 })
  }

  const { id } = await params
  try {
    const matterId = await resolveMatterId(id)
    const payload = await buildDraftPayload(matterId, { designSheetOverride: body.sheet })
    const data = toEstateGeneratorData(payload) as unknown as NodeEstateData
    const context = buildNodeEstateContext({ data, state: payload.client.state ?? 'MA' })
    return NextResponse.json({ clauses: buildClausePreviews(context) })
  } catch (error) {
    console.error('[clause preview route]', id, error)
    return NextResponse.json(
      { error: (error as Error).message || 'Clause preview failed' },
      { status: 400 },
    )
  }
}
