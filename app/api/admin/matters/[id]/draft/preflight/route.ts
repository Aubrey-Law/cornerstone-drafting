import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { buildDraftPayload, resolveMatterId } from '@/lib/buildDraftPayload'
import { buildEstateDraftPreflight } from '@/lib/estateGenerator/preflight'
import { publishedTemplatePreflightError } from '@/lib/documentTemplates/preflight'

type Params = { params: Promise<{ id: string }> }

// The attorney re-runs preflight immediately after editing the design sheet, so
// a cached response would keep reporting fields they just filled in.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params

  try {
    const canonicalMatterId = await resolveMatterId(matterId)
    let payload

    try {
      payload = await buildDraftPayload(canonicalMatterId)
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400, headers: NO_STORE })
    }

    if (!payload.design_sheet_id) {
      return NextResponse.json(
        { error: 'No design sheet found for this matter. Complete the design sheet before drafting.' },
        { status: 422, headers: NO_STORE },
      )
    }

    const preflight = buildEstateDraftPreflight(payload)
    const templateError = await publishedTemplatePreflightError(payload)
    if (templateError) {
      preflight.canGenerate = false
      preflight.error = templateError
    }
    return NextResponse.json(preflight, { headers: NO_STORE })
  } catch (error) {
    console.error('[draft preflight route]', matterId, error)
    return NextResponse.json(
      { error: 'Draft preflight failed', detail: (error as Error).message },
      { status: 500, headers: NO_STORE },
    )
  }
}
