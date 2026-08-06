import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingSnapshot, RevenueCategory } from '@/lib/billing/types'
import { money, percentOf, trend } from './financeFormat'

const CATEGORIES: {
  key: RevenueCategory
  label: string
  color: string
  unit: string
}[] = [
  { key: 'trust', label: 'Trust plans', color: 'var(--chart-1)', unit: 'packages' },
  { key: 'will', label: 'Will plans', color: 'var(--chart-2)', unit: 'plans' },
  { key: 'probate', label: 'Probate', color: 'var(--chart-3)', unit: 'matters' },
  { key: 'legal', label: 'Legal plans', color: 'var(--chart-4)', unit: 'engagements' },
]

/**
 * Year-to-date engaged fees split by plan type — the firm's income mix.
 * Percentages are of the YTD total, so an all-zero year renders an empty bar
 * rather than dividing by zero.
 */
export function RevenueSourcesCard({ revenue }: { revenue: BillingSnapshot['revenue'] }) {
  const total = revenue.total.current
  const change = trend(
    revenue.total.prior === 0
      ? null
      : Math.round(((total - revenue.total.prior) / revenue.total.prior) * 100),
  )

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Revenue sources</CardTitle>
      </CardHeader>
      <CardContent className="px-4 py-4">
        <p className="text-xs font-medium text-muted-foreground">Engaged fees, year to date</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{money(total)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {change.percent === null ? (
            'No engaged fees at this point last year'
          ) : (
            <>
              <span className={change.positive ? 'font-medium text-green' : 'font-medium text-destructive'}>
                {change.label}
              </span>
              {' compared to last year'}
            </>
          )}
        </p>

        <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {CATEGORIES.map(category => {
            const width = percentOf(revenue[category.key].current, total)
            if (width === 0) return null
            return (
              <span
                key={category.key}
                style={{ width: `${width}%`, backgroundColor: category.color }}
              />
            )
          })}
        </div>

        <dl className="mt-4 space-y-3">
          {CATEGORIES.map(category => {
            const rollup = revenue[category.key]
            return (
              <div key={category.key} className="flex items-center justify-between gap-3">
                <dt className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                    aria-hidden
                  />
                  <span className="truncate">{category.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {rollup.count} {category.unit}
                  </span>
                </dt>
                <dd className="shrink-0 text-sm font-medium tabular-nums">{money(rollup.current)}</dd>
              </div>
            )
          })}
        </dl>
      </CardContent>
    </Card>
  )
}
