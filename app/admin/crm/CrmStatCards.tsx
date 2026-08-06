import { Briefcase, Users, UserCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { CrmDashboardSnapshot, CrmTotal } from '@/lib/crm/dashboard'

const NUMBER = new Intl.NumberFormat('en-US')

function ConversionRing({ percent }: { percent: number }) {
  const circumference = 2 * Math.PI * 30
  const dash = (percent / 100) * circumference
  return (
    <svg viewBox="0 0 70 70" className="size-16 shrink-0 -rotate-90" aria-hidden>
      <circle cx="35" cy="35" r="30" fill="none" stroke="var(--muted)" strokeWidth="8" />
      <circle
        cx="35"
        cy="35"
        r="30"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
      />
    </svg>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  value: CrmTotal
  caption: string
}) {
  const rising = value.deltaPercent !== null && value.deltaPercent >= 0
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardContent className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{NUMBER.format(value.count)}</p>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {value.deltaPercent === null ? (
            `${value.newThisMonth} new this month`
          ) : (
            <>
              <span className={rising ? 'font-medium text-green' : 'font-medium text-destructive'}>
                {rising ? '+' : ''}{value.deltaPercent}%
              </span>
              {' from last month'}
            </>
          )}
          {' · '}
          {caption}
        </p>
      </CardContent>
    </Card>
  )
}

export function CrmStatCards({ snapshot }: { snapshot: CrmDashboardSnapshot }) {
  const { conversion } = snapshot
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="min-w-0 gap-0 py-0">
        <CardContent className="px-4 py-4">
          <p className="text-sm font-semibold">
            {conversion.percent >= 50 ? 'Conversion is holding' : 'Conversion has room'}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="relative">
              <ConversionRing percent={conversion.percent} />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
                {conversion.percent}%
              </span>
            </div>
            <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
              {NUMBER.format(conversion.converted)} of {NUMBER.format(conversion.total)} people have
              converted to a matter.
            </p>
          </div>
        </CardContent>
      </Card>

      <StatCard
        icon={Users}
        label="Total people"
        value={snapshot.people}
        caption={`${snapshot.people.newThisMonth} new`}
      />
      <StatCard
        icon={Briefcase}
        label="Active pipeline"
        value={snapshot.activePipeline}
        caption={`${snapshot.followUps.overdue} follow-up${snapshot.followUps.overdue === 1 ? '' : 's'} overdue`}
      />
      <StatCard
        icon={UserCheck}
        label="Converted"
        value={snapshot.converted}
        caption={`${snapshot.conversion.percent}% of all people`}
      />
    </div>
  )
}
