import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchMatterDashboard } from '@/lib/queries/matterDashboard'
import { loadMatterCloseoutSummary } from '@/lib/matters/closeout'
import { reviewClient } from '@/lib/review/staff'
import Link from 'next/link'
import { MatterCloseoutCard } from '@/app/admin/matters/(overview)/MatterCloseoutCard'
import { MatterSliceCard } from '@/app/admin/matters/(overview)/MatterSliceCard'
import { MatterStatCards } from '@/app/admin/matters/(overview)/MatterStatCards'
import { RecentMattersTable } from '@/app/admin/matters/(overview)/RecentMattersTable'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { attentionRecordIds, buildRecordWorkSummaries } from '@/lib/work/recordSummary'

export const dynamic = 'force-dynamic'


export async function MattersOverviewSection() {
  const auth = await getCachedClaims()
  const [{ snapshot, aging, error }, closeout, graph] = await Promise.all([
    fetchMatterDashboard(auth?.id ?? null),
    loadMatterCloseoutSummary(reviewClient()),
    fetchWorkGraphForUser(auth?.id ?? null),
  ])
  const workSummaries = buildRecordWorkSummaries(graph.items, 'matter')
  const canonicalSnapshot = { ...snapshot, needsAttention: attentionRecordIds(workSummaries).length }

  return (
    <section aria-labelledby="overview-matters" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="overview-matters" className="scroll-mt-20 text-lg font-semibold">Matters</h2><p className="text-sm text-muted-foreground">Open work, attention, and close-out.</p></div>
        <Link href="/admin/matters/list" className="shrink-0 text-sm font-medium hover:underline">View all matters</Link>
      </div>

      {/*
        Reported rather than thrown, the way the CRM dashboard does it: a failed
        read should cost you the numbers, not the page.
      */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive"
        >
          Matter data could not be fully loaded: {error}
        </div>
      )}

      <MatterStatCards snapshot={canonicalSnapshot} aging={aging} />

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Stage and practice breakdown</summary>
        <div className="mt-4">
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <MatterSliceCard
          title="By stage"
          description="Open matters in the firm's stage order"
          slices={canonicalSnapshot.stages}
          emptyLabel="No open matters."
        />
        <MatterSliceCard
          title="Practice areas"
          description="How the open book divides up"
          slices={canonicalSnapshot.practiceAreas}
          emptyLabel="No open matters."
        />
      </div>
        </div>
      </details>

      <MatterCloseoutCard summary={closeout} />

      <RecentMattersTable matters={canonicalSnapshot.recent} workSummaries={workSummaries} />
    </section>
  )
}
