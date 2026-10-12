import Link from 'next/link'
import { CrmPipelineCard } from '@/app/admin/crm/CrmPipelineCard'
import { LeadSourcesCard } from '@/app/admin/crm/LeadSourcesCard'
import { MatterCloseoutCard } from '@/app/admin/matters/(overview)/MatterCloseoutCard'
import { MatterSliceCard } from '@/app/admin/matters/(overview)/MatterSliceCard'
import { RecentMattersTable } from '@/app/admin/matters/(overview)/RecentMattersTable'
import type { FirmDashboardSnapshot, FirmMetric } from '@/lib/firm/dashboard'
import type { CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import type { MatterCloseoutSummary } from '@/lib/matters/closeout'
import type { MatterDashboardSnapshot } from '@/lib/matters/dashboard'
import type { MatterListRow } from '@/lib/queries/matters'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'
import { cn } from '@/lib/utils'

const NUMBER = new Intl.NumberFormat('en-US')

function MetricCard({ metric }: { metric: FirmMetric }) {
  return (
    <Link
      href={metric.href}
      className={cn(
        'block rounded-xl border bg-card px-4 py-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        metric.attention ? 'border-destructive/40' : 'border-border',
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
        {metric.value === null ? '—' : NUMBER.format(metric.value)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{metric.caption}</p>
    </Link>
  )
}

export function FirmDashboardView({
  snapshot,
  matters,
  crm,
  recent,
  closeout,
  workSummaries = {},
  mattersError,
  crmError,
  truncated,
  peopleCeiling,
}: {
  snapshot: FirmDashboardSnapshot
  matters: MatterDashboardSnapshot
  crm: CrmDashboardSnapshot
  recent: MatterListRow[]
  closeout: MatterCloseoutSummary
  workSummaries?: Record<string, RecordWorkSummary>
  mattersError: string | null
  crmError: string | null
  truncated: boolean
  peopleCeiling: number
}) {
  return (
    <div className="min-w-0 space-y-8" data-testid="firm-dashboard">
      {mattersError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive">
          Matter data could not be fully loaded: {mattersError}
        </div>
      )}
      {crmError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive">
          CRM data could not be fully loaded: {crmError}
        </div>
      )}
      {snapshot.tasksUnavailable && (
        <p role="alert" className="text-sm text-destructive">Task counts are unavailable. Please retry.</p>
      )}
      {truncated && (
        <p role="status" className="text-xs text-muted-foreground">
          Lead counts cover the {peopleCeiling.toLocaleString('en-US')} most recent contacts. The book is
          larger than that, so these are a sample rather than a total.
        </p>
      )}

      <section id="firm-pulse" aria-labelledby="firm-pulse-heading" className="scroll-mt-20">
        <h2 id="firm-pulse-heading" className="sr-only">Firm pulse</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {snapshot.metrics.map(metric => <MetricCard key={metric.key} metric={metric} />)}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section id="firm-attention" aria-labelledby="firm-attention-heading" className="scroll-mt-20 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 id="firm-attention-heading" className="text-sm font-semibold">Needs a decision</h2>
            <p className="text-xs text-muted-foreground">Firm-wide pressure, most urgent first. Each row opens the list that holds it.</p>
          </div>
          {snapshot.attention.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">Nothing in the firm queue needs a decision right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {snapshot.attention.map(item => (
                <li key={item.key}>
                  <Link href={item.href} className="flex items-baseline gap-3 px-4 py-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="w-10 shrink-0 text-lg font-semibold tabular-nums">{NUMBER.format(item.count)}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div id="firm-book" className="scroll-mt-20 space-y-4">
          <MatterSliceCard
            title="Matters by stage"
            description="Open matters in the firm's stage order"
            slices={matters.stages}
            emptyLabel="No open matters."
          />
          <MatterSliceCard
            title="Practice areas"
            description="How the open book divides up"
            slices={matters.practiceAreas}
            emptyLabel="No open matters."
          />
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <CrmPipelineCard stages={crm.pipeline} />
        <LeadSourcesCard sources={crm.leadSources} />
      </div>

      <section id="firm-closeout" className="scroll-mt-20">
        <MatterCloseoutCard summary={closeout} />
      </section>

      <RecentMattersTable matters={recent} workSummaries={workSummaries} />
    </div>
  )
}
