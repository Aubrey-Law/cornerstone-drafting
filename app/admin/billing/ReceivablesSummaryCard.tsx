import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingSnapshot } from '@/lib/billing/types'
import { money, percentOf } from './financeFormat'

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Open receivables split by age. A donut plus percentage tiles, so the eye can
 * take the shape of the book without reading four numbers.
 */
export function ReceivablesSummaryCard({ snapshot }: { snapshot: BillingSnapshot }) {
  const buckets = [
    { key: 'current', label: '0–30 days', amount: snapshot.aging.current, color: 'var(--chart-1)' },
    { key: 'days31To60', label: '31–60 days', amount: snapshot.aging.days31To60, color: 'var(--chart-3)' },
    { key: 'days61Plus', label: '61+ days', amount: snapshot.aging.days61Plus, color: 'var(--destructive)' },
  ]
  const total = buckets.reduce((sum, bucket) => sum + bucket.amount, 0)

  let offset = 0
  const arcs = buckets.map(bucket => {
    const fraction = total > 0 ? bucket.amount / total : 0
    const arc = { ...bucket, dash: fraction * CIRCUMFERENCE, offset }
    offset += fraction * CIRCUMFERENCE
    return arc
  })

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Receivables summary</CardTitle>
        <p className="text-xs text-muted-foreground">
          Open balances by age
          {snapshot.averageDaysToCollect.all !== null
            ? ` · ${snapshot.averageDaysToCollect.all}d average to collect`
            : ''}
        </p>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <div className="relative mx-auto size-36">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth="12" />
            {arcs.map(arc => (
              arc.dash > 0 && (
                <circle
                  key={arc.key}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="12"
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={-arc.offset}
                />
              )
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xl font-semibold tabular-nums">{money(total)}</p>
            <p className="text-micro text-muted-foreground">open</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2">
          {buckets.map(bucket => (
            <div
              key={bucket.key}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2"
            >
              <dt className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: bucket.color }}
                  aria-hidden
                />
                <span className="truncate">{bucket.label}</span>
              </dt>
              <dd className="shrink-0 text-xs font-semibold tabular-nums">
                {percentOf(bucket.amount, total)}%
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2">
            <dt className="truncate text-xs text-muted-foreground">Plan claims open</dt>
            <dd className="shrink-0 text-xs font-semibold tabular-nums">
              {snapshot.openClaims.length}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
