import Link from 'next/link'
import { AlarmClock, Briefcase, FileSignature, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { MatterDashboardSnapshot, MatterTotal } from '@/lib/matters/dashboard'
import type { MatterAgingTiles } from '@/lib/queries/pipelineAging'

const NUMBER = new Intl.NumberFormat('en-US')

/**
 * Every tile is a link, not a number to look at.
 *
 * A count that tells you something needs attention and then leaves you to find
 * it is only half a signal — each of these lands on the filtered list that
 * contains exactly the matters it counted.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  href,
}: {
  icon: LucideIcon
  label: string
  value: number
  caption: React.ReactNode
  href: string
}) {
  return (
    <Card className="min-w-0 gap-0 py-0 transition-colors hover:bg-accent">
      <CardContent className="px-4 py-4">
        <Link href={href} className="block">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{NUMBER.format(value)}</p>
            </div>
            <span className="hidden size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted sm:flex">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
        </Link>
      </CardContent>
    </Card>
  )
}

function MonthDelta({ total }: { total: MatterTotal }) {
  if (total.deltaPercent === null) return <>{total.newThisMonth} opened this month</>
  const rising = total.deltaPercent >= 0
  return (
    <>
      <span className={rising ? 'font-medium text-green' : 'font-medium text-destructive'}>
        {rising ? '+' : ''}
        {total.deltaPercent}%
      </span>
      {' from last month'}
    </>
  )
}

export function MatterStatCards({
  snapshot,
}: {
  snapshot: MatterDashboardSnapshot
  aging: MatterAgingTiles
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={Briefcase}
        label="Open matters"
        value={snapshot.open.count}
        caption={<MonthDelta total={snapshot.open} />}
        href="/admin/matters/list"
      />
      <StatCard
        icon={AlarmClock}
        label="Needs attention"
        value={snapshot.needsAttention}
        caption="Firm-owned Critical, Must do, and Soon work"
        href="/admin/matters/list?card=attention"
      />
      <StatCard
        icon={FileSignature}
        label="Signing soon"
        value={snapshot.signingSoon}
        caption="Signing date within 30 days"
        href="/admin/matters/list?card=signing"
      />
    </div>
  )
}
