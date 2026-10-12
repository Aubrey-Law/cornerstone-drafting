import Link from 'next/link'
import { BillingRail } from './BillingRail'
import { BillingWorkSummary } from './BillingWorkSummary'
import { RecentPaymentsCard } from './RecentPaymentsCard'
import { money } from './financeFormat'
import { filterBillingRows } from '@/lib/billing/metrics'
import type { BillingFilter, BillingNudge, BillingSnapshot } from '@/lib/billing/types'

/**
 * What Billing opens on: the three queues, what came in this month, and the
 * follow-ups that still need a person. Charts stay on Reports.
 */
export function BillingDashboard({
  snapshot,
  counts,
  onNudgeAction,
  onDismiss,
}: {
  snapshot: BillingSnapshot
  counts: Record<BillingFilter, number>
  onNudgeAction: (nudge: BillingNudge) => void
  onDismiss: (nudge: BillingNudge) => void
}) {
  const month = snapshot.selectedMonth
  const reportsHref = `/admin/billing?tab=insights&month=${month}`
  const amountFor = (filter: BillingFilter) =>
    filterBillingRows(snapshot.rows, filter, '', month).reduce((sum, row) => sum + row.balance, 0)

  return (
    <div className="min-w-0 space-y-4">
      <BillingWorkSummary
        counts={counts}
        month={month}
        amounts={{
          to_invoice: amountFor('to_invoice'),
          open: amountFor('open'),
          overdue: amountFor('overdue'),
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={reportsHref}
          className="rounded-lg border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
        >
          <p className="text-xs font-medium text-muted-foreground">Collected this month</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(snapshot.collectedMonth.amount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Open reports for the month</p>
        </Link>
        <Link
          href={`/admin/billing?tab=ledger&month=${month}`}
          className="rounded-lg border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
        >
          <p className="text-xs font-medium text-muted-foreground">Still to collect</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(snapshot.outstanding.amount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {snapshot.outstanding.openCount} open charge{snapshot.outstanding.openCount === 1 ? '' : 's'}
          </p>
        </Link>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
        <RecentPaymentsCard payments={snapshot.recentPayments} />
        <BillingRail snapshot={snapshot} onNudgeAction={onNudgeAction} onDismiss={onDismiss} />
      </div>
    </div>
  )
}
