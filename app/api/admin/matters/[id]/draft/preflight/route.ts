import { NextRequest, NextResponse } from 'next/server'
import { loadDraftSourceSnapshot } from '@/lib/drafting/sourceSnapshot'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/buildDraftPayload'
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
    const canonicalMatterId = await resolveMatterId(matterId).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!canonicalMatterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    let payload
    let revision

    try {
      const snapshot = await loadDraftSourceSnapshot(canonicalMatterId)
      payload = snapshot.payload
      revision = snapshot.revision
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
    return NextResponse.json({ ...preflight, sourceRevision: revision }, { headers: NO_STORE })
  } catch (error) {
    console.error('[draft preflight route]', matterId, error)
    return NextResponse.json(
      { error: 'Draft preflight failed', detail: (error as Error).message },
      { status: 500, headers: NO_STORE },
    )
  }
}
