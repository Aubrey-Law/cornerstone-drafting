import type { Metadata } from 'next'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchCrmDashboard } from '@/lib/queries/crmDashboard'
import { PageHeader } from '@/components/PageHeader'
import { CrmPipelineCard } from './CrmPipelineCard'
import { CrmStatCards } from './CrmStatCards'
import { OpenTasksCard } from '@/components/tasks/OpenTasksCard'
import { LeadSourcesCard } from './LeadSourcesCard'
import { RecentPeopleTable } from './RecentPeopleTable'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'CRM' }

export default async function AdminCrmPage() {
  const auth = await getCachedClaims()
  const { snapshot, tasks, truncated, peopleCeiling, error } = await fetchCrmDashboard(auth?.id ?? null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="CRM"
        description="People, pipeline, and follow-up across the firm's whole book."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive"
        >
          CRM data could not be fully loaded: {error}
        </div>
      )}

      {truncated && (
        <p role="status" className="text-xs text-muted-foreground">
          Counts cover the {peopleCeiling.toLocaleString('en-US')} most recent contacts. The book is
          larger than that, so these are a sample rather than a total.
        </p>
      )}

      <CrmStatCards snapshot={snapshot} />

      <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <LeadSourcesCard sources={snapshot.leadSources} />
        <OpenTasksCard tasks={tasks} />
        <CrmPipelineCard stages={snapshot.pipeline} />
      </div>

      <RecentPeopleTable people={snapshot.recentPeople} />
    </div>
  )
}
