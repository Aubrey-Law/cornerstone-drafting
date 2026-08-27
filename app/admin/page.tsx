import Link from 'next/link'
import { CalendarClock, CheckCircle2, Inbox } from 'lucide-react'
import { ComingDueCard } from '@/app/admin/components/ComingDueCard'
import { NextActionsCard } from '@/app/admin/components/NextActionsCard'
import { DailyBriefCard } from '@/app/admin/components/DailyBriefCard'
import { TodayQueue, type TodayMatterItem } from '@/app/admin/components/TodayQueue'
import { TodayBillingCard } from '@/app/admin/components/TodayBillingCard'
import { TodayClearedCard } from '@/app/admin/components/TodayClearedCard'
import { fetchTodayData } from '@/lib/queries/today'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { stageLabel, type MatterStage, type PipelineMatter } from '@/types/database'
import { PageHeader } from '@/components/PageHeader'
import { AdminPageShell } from '@/components/layout/AdminPageShell'

export const dynamic = 'force-dynamic'

function toMatterItem(m: PipelineMatter): TodayMatterItem {
  return {
    matter_id: m.matter_id,
    client_name: m.client_name ?? m.matter_name ?? null,
    stage_label: stageLabel(m.stage as MatterStage),
  }
}

const APPOINTMENT_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: FIRM_TIMEZONE,
})

export default async function AdminTodayPage() {
  const today = await fetchTodayData()
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: FIRM_TIMEZONE,
  }).format(new Date())

  const allClear = [
    today.overdueTasks.length === 0 && 'No overdue tasks',
    today.unreadThreads.length === 0 && 'No unread client messages',
    today.intakeReview.length === 0 && 'No intakes waiting on review',
    today.intakeToSend.length === 0 && 'Every open matter has its intake out',
  ].filter(Boolean) as string[]

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1240px]">
      <PageHeader
        title={dateLabel}
        description={
          <>
          {today.overdueTasks.length} task{today.overdueTasks.length === 1 ? '' : 's'} overdue
          {' · '}
          {today.tasksDueToday.length} due today
          {' · '}
          {today.overdueMatterCount} matter{today.overdueMatterCount === 1 ? '' : 's'}
          {' · '}
          {today.overdueLeadCount} lead{today.overdueLeadCount === 1 ? '' : 's'} over SLA
          {' · '}
          {today.appointmentsToday.length} appointment{today.appointmentsToday.length === 1 ? '' : 's'}
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-[560px]">
          <TodayQueue
            waitingOnYou={today.waitingOnYou}
            waitingOnClient={today.waitingOnClient}
            snoozed={today.snoozed}
            unreadThreads={today.unreadThreads}
            intakeReview={today.intakeReview.map(toMatterItem)}
            intakeToSend={today.intakeToSend.map(toMatterItem)}
            overdueTasks={today.overdueTasks}
            tasksDueToday={today.tasksDueToday}
          />

          <details className="group mt-4 rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground marker:content-none">
              <span>Later · planning and context</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <div className="grid gap-4 border-t border-border p-3 md:grid-cols-2">
              <NextActionsCard />
              <ComingDueCard />
              <DailyBriefCard />

              {allClear.length > 0 && (
                <section className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green" aria-hidden />
                    All clear
                  </h2>
                  <ul className="mt-1.5 space-y-1">
                    {allClear.map(line => (
                      <li key={line} className="text-xs text-muted-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <TodayClearedCard />
            </div>
          </details>
        </div>

        <aside className="basis-[280px] grow space-y-3 lg:sticky lg:top-4 lg:max-w-[320px] lg:self-start">
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Your day</h2>
            </header>
            {today.appointmentsToday.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">Nothing scheduled today</p>
            ) : (
              <ul className="divide-y divide-border">
                {today.appointmentsToday.slice(0, 4).map(appt => (
                  <li key={appt.id}>
                    <Link
                      href={appt.href}
                      className="block px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <span className="font-medium tabular-nums text-foreground">
                        {appt.is_all_day
                          ? 'All day'
                          : APPOINTMENT_TIME.format(new Date(appt.next_appointment))}
                      </span>
                      <span className="text-foreground"> · {appt.client_name ?? 'Unnamed matter'}</span>
                      {appt.next_appointment_type && (
                        <span className="text-muted-foreground"> · {appt.next_appointment_type}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {today.appointmentsToday.length > 4 && (
              <Link
                href="/admin/calendar"
                className="block border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                View {today.appointmentsToday.length - 4} more appointment{today.appointmentsToday.length - 4 === 1 ? '' : 's'}
              </Link>
            )}
          </section>

          <TodayBillingCard billing={today.billing} />

          <p className="px-1">
            <Link
              href="/admin/matters/list"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Inbox className="h-3.5 w-3.5" aria-hidden />
              All matters
            </Link>
          </p>
        </aside>
      </div>
    </AdminPageShell>
  )
}
