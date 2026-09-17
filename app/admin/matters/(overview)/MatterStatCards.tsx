import Link from 'next/link'
import { AlarmClock, Briefcase, FileSignature, Inbox, type LucideIcon } from 'lucide-react'
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
              <p className="mt-1 text-3xl font-semibold tabular-nums">{NUMBER.format(value)}</p>
            </div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
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
  aging,
}: {
  snapshot: MatterDashboardSnapshot
  aging: MatterAgingTiles
}) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Briefcase}
        label="Open matters"
        value={snapshot.open.count}
        caption={<MonthDelta total={snapshot.open} />}
        href="/admin/matters/list"
      />
      <StatCard
        icon={Inbox}
        label="Awaiting intake"
        value={snapshot.awaitingIntake}
        caption="Intake not yet submitted"
        href="/admin/matters/list"
      />
      <StatCard
        icon={AlarmClock}
        label="Needs attention"
        value={snapshot.needsAttention}
        caption={
          aging.red > 0
            ? `${aging.red} past SLA${aging.amber > 0 ? `, ${aging.amber} approaching` : ''}`
            : 'Quiet or with uploads to read'
        }
        href="/admin/pipeline/aging"
      />
      <StatCard
        icon={FileSignature}
        label="Signing soon"
        value={snapshot.signingSoon}
        caption="Signing date within 30 days"
        href="/admin/matters/list"
      />
    </div>
  )
}
