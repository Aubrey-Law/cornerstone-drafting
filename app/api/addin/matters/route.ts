import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchDraftingHubMatters } from '@/lib/queries/drafting'
import { DEFAULT_HUB_VIEW } from '@/lib/drafting/hubView'
import { getAdminClient } from '@/lib/supabaseAdmin'

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

type PickerMatter = {
  id: string
  matterNumber: string | null
  clientName: string | null
  spouseName: string | null
  stage: string | null
  planType: string | null
  designStatus: string | null
  draftCount: number
}

/**
 * Matters — leads' opportunities included — with an engagement agreement still
 * being drafted, so its Word document can be edited from the pane. The drafting
 * worklist above only holds matters already in drafting, which is after the
 * engagement is signed, so none of these would otherwise be offered.
 */
async function engagementDraftMatters(search: string): Promise<PickerMatter[]> {
  const admin = getAdminClient()
  const { data: agreements, error } = await admin
    .from('engagement_agreements')
    .select('matter_id')
    .in('status', ['draft', 'ready', 'failed'])
    .not('document_id', 'is', null)
    .limit(200)
  if (error) {
    console.error('[addin/matters] engagement drafts', error.message)
    return []
  }
  const ids = [...new Set((agreements ?? []).map(row => String(row.matter_id)))]
  if (ids.length === 0) return []
  const { data: matters } = await admin
    .from('v_matter_pipeline_all')
    .select('matter_id, client_name, spouse_name, stage, plan_type')
    .in('matter_id', ids)
  const needle = search.toLowerCase()
  return (matters ?? [])
    .filter(row => !needle || [row.client_name, row.spouse_name].some(name => String(name ?? '').toLowerCase().includes(needle)))
    .map(row => ({
      id: String(row.matter_id),
      matterNumber: null,
      clientName: row.client_name ?? null,
      spouseName: row.spouse_name ?? null,
      stage: row.stage ?? 'engagement',
      planType: row.plan_type ?? null,
      designStatus: null,
      draftCount: 0,
    }))
}

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

  const drafting: PickerMatter[] = page.matters.map(row => ({
    id: row.matter.matter_id,
    matterNumber: row.matterNumber,
    clientName: row.matter.client_name,
    spouseName: row.matter.spouse_name,
    stage: row.matter.stage,
    planType: row.matter.plan_type,
    designStatus: row.designSheet?.status ?? null,
    draftCount: row.draftCount,
  }))
  const seen = new Set(drafting.map(row => row.id))
  const engagement = (await engagementDraftMatters(search)).filter(row => !seen.has(row.id))
  const total = page.total + engagement.length

  return NextResponse.json(
    {
      // Engagement drafts lead: there are few, and they are the ones a client is waiting on.
      matters: [...engagement, ...drafting].slice(0, PAGE_SIZE),
      total,
      // The pane says "showing 25 of N" rather than paging: an attorney who
      // cannot see their matter types a name, which is what search is for.
      truncated: total > PAGE_SIZE,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
