import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingSnapshot, RevenueCategory, RevenueRollup } from '@/lib/billing/types'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const categories: {
  key: RevenueCategory
  label: string
  stroke: string
  unit: string
}[] = [
  { key: 'trust', label: 'Trust plans', stroke: 'var(--brand-navy)', unit: 'packages' },
  { key: 'will', label: 'Will plans', stroke: 'var(--stage-early)', unit: 'plans' },
  { key: 'probate', label: 'Probate', stroke: 'var(--stage-work)', unit: 'matters' },
  { key: 'legal', label: 'Legal plans', stroke: 'var(--stage-active)', unit: 'engagements' },
]

function delta(rollup: RevenueRollup): string {
  if (rollup.prior === 0) return rollup.current > 0 ? 'New this year' : 'No change'
  const percent = Math.round(((rollup.current - rollup.prior) / rollup.prior) * 100)
  return `${percent >= 0 ? '▲' : '▼'} ${Math.abs(percent)}%`
}
function RevenueRing({
  value,
  total,
  stroke,
  label,
}: {
  value: number
  total: number
  stroke: string
  label: string
}) {
  const circumference = 50.27
  const dash = total > 0 ? (value / total) * circumference : 0
  return (
    <svg viewBox="0 0 20 20" className="size-9 shrink-0 -rotate-90" role="img" aria-label={label}>
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--muted)" strokeWidth="3" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
      />
    </svg>
  )
}

function RevenueTile({
  label,
  rollup,
  total,
  stroke,
  detail,
}: {
  label: string
  rollup: RevenueRollup
  total: number
  stroke: string
  detail: string
}) {
  const positive = rollup.current >= rollup.prior
  return (
    <div className="min-w-0 border-t border-border px-4 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{MONEY.format(rollup.current / 100)}</p>
        </div>
        <RevenueRing
          value={rollup.current}
          total={total}
          stroke={stroke}
          label={`${label} share of engaged fees`}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className={positive ? 'font-medium text-green' : 'font-medium text-destructive'}>
          {delta(rollup)}
        </span>
        {' · '}
        {detail}
      </p>
    </div>
  )
}

export function RevenueTiles({ revenue }: { revenue: BillingSnapshot['revenue'] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Engaged revenue</CardTitle>
      </CardHeader>
      <CardContent className="grid p-0 sm:grid-cols-2 xl:grid-cols-5">
        <RevenueTile
          label="Total"
          rollup={revenue.total}
          total={revenue.total.current}
          stroke="var(--brand-teal)"
          detail={`${revenue.total.count} engagement${revenue.total.count === 1 ? '' : 's'}`}
        />
        {categories.map(category => {
          const rollup = revenue[category.key]
          return (
            <RevenueTile
              key={category.key}
              label={category.label}
              rollup={rollup}
              total={revenue.total.current}
              stroke={category.stroke}
              detail={`${rollup.count} ${category.unit}`}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}
