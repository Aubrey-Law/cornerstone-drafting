import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchDraftingHubMatters } from '@/lib/queries/drafting'
import { DEFAULT_HUB_VIEW } from '@/lib/drafting/hubView'

export const dynamic = 'force-dynamic'

/**
 * The matters the Word pane offers to draft against.
 *
 * Reuses the drafting worklist query rather than selecting from `matters`
 * directly, so the pane's list is the same list — same search, same ordering,
 * and the same hiding of closed matters, which `drafting_hub_page` does in SQL
 * along both of the two axes a matter can be closed on. A separate query here
 * would be a second answer to "what am I drafting", and the one most likely to
 * still offer a matter the firm closed last week.
 *
 * Slimmed to what a picker in a 320px task pane can show. The full hub row
 * carries draft listings and document inclusions the pane has no use for.
 */
const PAGE_SIZE = 25

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const search = new URL(req.url).searchParams.get('q')?.trim() ?? ''

  const page = await fetchDraftingHubMatters({
    ...DEFAULT_HUB_VIEW,
    search,
    page: 1,
  })

  if (page.error) {
    return NextResponse.json({ error: page.error }, { status: 502 })
  }

  return NextResponse.json(
    {
      matters: page.matters.slice(0, PAGE_SIZE).map(row => ({
        id: row.matter.matter_id,
        matterNumber: row.matterNumber,
        clientName: row.matter.client_name,
        spouseName: row.matter.spouse_name,
        stage: row.matter.stage,
        planType: row.matter.plan_type,
        designStatus: row.designSheet?.status ?? null,
        draftCount: row.draftCount,
      })),
      total: page.total,
      // The pane says "showing 25 of N" rather than paging: an attorney who
      // cannot see their matter types a name, which is what search is for.
      truncated: page.total > PAGE_SIZE,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
