import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { BillingSnapshot } from '@/lib/billing/types'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function amount(cents: number) {
  return MONEY.format(cents / 100)
}
function Kpi({
  label,
  value,
  detail,
  children,
}: {
  label: string
  value: string
  detail: string
  children?: React.ReactNode
}) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {children}
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

export function KpiRow({ snapshot }: { snapshot: BillingSnapshot }) {
  const monthDelta = snapshot.collectedMonth.deltaPercent
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Outstanding"
        value={amount(snapshot.outstanding.amount)}
        detail={`${snapshot.outstanding.openCount} open · ${amount(snapshot.outstanding.overdueAmount)} overdue`}
      />
      <Kpi
        label="Collected — month"
        value={amount(snapshot.collectedMonth.amount)}
        detail={
          monthDelta === null
            ? `${amount(snapshot.collectedMonth.priorAmount)} prior month`
            : `${monthDelta >= 0 ? '▲' : '▼'} ${Math.abs(monthDelta)}% vs prior month`
        }
      />
      <Kpi
        label="Collected — YTD"
        value={amount(snapshot.collectedYtd.amount)}
        detail={`${snapshot.collectedYtd.progressPercent}% of ${amount(snapshot.collectedYtd.goal)} goal`}
      >
        <Progress
          value={snapshot.collectedYtd.progressPercent}
          className="mt-2 h-1.5"
          aria-label={`${snapshot.collectedYtd.progressPercent}% of annual collection goal`}
        />
      </Kpi>
      <Kpi
        label="Avg days to collect"
        value={snapshot.averageDaysToCollect.all === null ? '—' : `${snapshot.averageDaysToCollect.all}d`}
        detail={`Flat ${snapshot.averageDaysToCollect.flatFee ?? '—'}d · Plan ${snapshot.averageDaysToCollect.planClaim ?? '—'}d`}
      />
    </div>
  )
}
