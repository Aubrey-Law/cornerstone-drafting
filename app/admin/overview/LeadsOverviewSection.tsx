import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchCrmDashboard } from '@/lib/queries/crmDashboard'
import { PageHeader } from '@/components/PageHeader'
import { CrmPipelineCard } from '@/app/admin/crm/CrmPipelineCard'
import { CrmStatCards } from '@/app/admin/crm/CrmStatCards'
import { LeadSourcesCard } from '@/app/admin/crm/LeadSourcesCard'
import { RecentPeopleTable } from '@/app/admin/crm/RecentPeopleTable'

export const dynamic = 'force-dynamic'


export async function LeadsOverviewSection() {
  const auth = await getCachedClaims()
  const { snapshot, truncated, peopleCeiling, error } = await fetchCrmDashboard(auth?.id ?? null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
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

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <LeadSourcesCard sources={snapshot.leadSources} />
        <CrmPipelineCard stages={snapshot.pipeline} />
      </div>

      <RecentPeopleTable people={snapshot.recentPeople} />
    </div>
  )
}
