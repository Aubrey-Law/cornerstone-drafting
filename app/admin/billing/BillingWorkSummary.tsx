import Link from 'next/link'
import { AlertCircle, CircleDollarSign, FileClock } from 'lucide-react'
import type { BillingFilter } from '@/lib/billing/types'
import { cn } from '@/lib/utils'

const items: {
  filter: BillingFilter
  label: string
  icon: typeof FileClock
  tone: string
}[] = [
  { filter: 'to_invoice', label: 'Ready to invoice', icon: FileClock, tone: 'text-stage-active-text' },
  { filter: 'open', label: 'Open balances', icon: CircleDollarSign, tone: 'text-foreground' },
  { filter: 'overdue', label: 'Past due', icon: AlertCircle, tone: 'text-destructive' },
]

/** Compact entry points into the three queues staff work most often. */
export function BillingWorkSummary({
  counts,
  month,
  active,
}: {
  counts: Record<BillingFilter, number>
  month: string
  /** The ledger filter currently applied, so the matching queue reads as selected. */
  active?: BillingFilter
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" aria-label="Billing work summary">
      {items.map(item => {
        const Icon = item.icon
        const params = new URLSearchParams({ filter: item.filter, month })
        if (item.filter === 'open') params.delete('filter')
        return (
          <Link
            key={item.filter}
            href={`/admin/billing?${params}`}
            aria-label={`${item.label}: ${counts[item.filter]}`}
            aria-current={active === item.filter ? 'page' : undefined}
            className={cn(
              'flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent',
              active === item.filter
                ? 'border-primary bg-accent'
                : 'border-border bg-card',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon className={`size-4 ${item.tone}`} aria-hidden />
              {item.label}
            </span>
            <span className={`text-lg font-semibold tabular-nums ${item.tone}`}>
              {counts[item.filter]}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
