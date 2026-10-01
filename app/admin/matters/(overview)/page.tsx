import type { Metadata } from 'next'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchMatterDashboard } from '@/lib/queries/matterDashboard'
import { loadMatterCloseoutSummary } from '@/lib/matters/closeout'
import { reviewClient } from '@/lib/review/staff'
import { PageHeader } from '@/components/PageHeader'
import { OpenTasksCard } from '@/components/tasks/OpenTasksCard'
import { MatterCloseoutCard } from './MatterCloseoutCard'
import { MatterSliceCard } from './MatterSliceCard'
import { MatterStatCards } from './MatterStatCards'
import { RecentMattersTable } from './RecentMattersTable'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { attentionRecordIds, buildRecordWorkSummaries } from '@/lib/work/recordSummary'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Matters' }

export default async function MattersDashboardPage() {
  const auth = await getCachedClaims()
  const [{ snapshot, aging, tasks, tasksError, error }, closeout, graph] = await Promise.all([
    fetchMatterDashboard(auth?.id ?? null),
    loadMatterCloseoutSummary(reviewClient()),
    fetchWorkGraphForUser(auth?.id ?? null),
  ])
  const workSummaries = buildRecordWorkSummaries(graph.items, 'matter')
  const canonicalSnapshot = { ...snapshot, needsAttention: attentionRecordIds(workSummaries).length }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Matters"
        description="Where the firm's open work stands, and what is waiting on you."
      />

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

      <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <MatterSliceCard
          title="By stage"
          description="Open matters in the firm's stage order"
          slices={canonicalSnapshot.stages}
          emptyLabel="No open matters."
        />
        <OpenTasksCard tasks={tasks} error={tasksError} />
        <MatterSliceCard
          title="Practice areas"
          description="How the open book divides up"
          slices={canonicalSnapshot.practiceAreas}
          emptyLabel="No open matters."
        />
      </div>

      <MatterCloseoutCard summary={closeout} />

      <RecentMattersTable matters={canonicalSnapshot.recent} workSummaries={workSummaries} />
    </div>
  )
}
