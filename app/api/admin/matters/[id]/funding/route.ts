import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fundingSummary } from '@/lib/funding/model'
import { loadFundingRows } from '@/lib/funding/repository'
import { toFundingAssets } from '@/lib/funding/rollup'
import { isUuid } from '@/lib/queries/tasks'
import { reviewClient } from '@/lib/review/staff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/matters/[id]/funding
 *
 * The matter's trust funding: each asset listed at intake, how it joins the
 * plan, and whether the institution has confirmed it. Read by the Funding
 * view of the matter's Assets tab. An empty list is an answer, not a 404 —
 * a lead, or a matter with nothing listed at intake, has nothing to track.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const assets = toFundingAssets(await loadFundingRows(reviewClient(), { matterId: id }))
    return NextResponse.json({ assets, summary: fundingSummary(assets) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load funding' },
      { status: 500 },
    )
  }
}
