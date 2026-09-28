import Link from 'next/link'
import { AlertCircle, CircleDollarSign, FileClock } from 'lucide-react'
import type { BillingFilter } from '@/lib/billing/types'

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
}: {
  counts: Record<BillingFilter, number>
  month: string
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
            className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
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
