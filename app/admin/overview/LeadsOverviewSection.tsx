import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchCrmDashboard } from '@/lib/queries/crmDashboard'
import Link from 'next/link'
import { CrmPipelineCard } from '@/app/admin/crm/CrmPipelineCard'
import { CrmStatCards } from '@/app/admin/crm/CrmStatCards'
import { LeadSourcesCard } from '@/app/admin/crm/LeadSourcesCard'
import { RecentPeopleTable } from '@/app/admin/crm/RecentPeopleTable'

export const dynamic = 'force-dynamic'


export async function LeadsOverviewSection() {
  const auth = await getCachedClaims()
  const { snapshot, truncated, peopleCeiling, error } = await fetchCrmDashboard(auth?.id ?? null)

  return (
    <section aria-labelledby="overview-leads" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="overview-leads" className="scroll-mt-20 text-lg font-semibold">Leads</h2><p className="text-sm text-muted-foreground">Pipeline and client follow-up.</p></div>
        <Link href="/admin/crm/opportunities" className="shrink-0 text-sm font-medium hover:underline">View all leads</Link>
      </div>

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

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Pipeline and sources</summary>
        <div className="mt-4">
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <LeadSourcesCard sources={snapshot.leadSources} />
        <CrmPipelineCard stages={snapshot.pipeline} />
      </div>
        </div>
      </details>

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Recent people</summary>
        <div className="mt-4"><RecentPeopleTable people={snapshot.recentPeople} /></div>
      </details>
    </section>
  )
}
