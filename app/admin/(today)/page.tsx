import { NavigationReady } from '@/app/admin/components/NavigationTiming'
import Link from 'next/link'
import { LazyPlanning } from '@/app/admin/components/LazyPlanning'
import { Suspense } from 'react'
import { TodayCalendar, TodayCalendarCard } from '@/app/admin/components/TodayCalendar'
import { CheckCircle2, Inbox } from 'lucide-react'
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
import { CommandCenter } from '@/app/admin/components/CommandCenter'
import { CommandCenterTelemetry } from '@/app/admin/components/CommandCenterTelemetry'
import { getCachedClaims } from '@/lib/supabaseServer'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { fetchDailyPlan } from '@/lib/work/plans'
import { getDailyPlanCalendarStatus } from '@/lib/work/dailyPlanCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function toMatterItem(m: PipelineMatter): TodayMatterItem {
  return {
    matter_id: m.matter_id,
    client_name: m.client_name ?? m.matter_name ?? null,
    stage_label: stageLabel(m.stage as MatterStage),
  }
}


async function LegacyTodayPage() {
  const today = await fetchTodayData({ includeCalendar: false })
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
    <>
      <NavigationReady route="Today" />
      <CommandCenterTelemetry event="legacy_today_opened" />
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

          <LazyPlanning>
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
          </LazyPlanning>
        </div>

        <aside className="basis-[280px] grow space-y-3 lg:sticky lg:top-4 lg:max-w-[320px] lg:self-start">
          <Suspense fallback={<TodayCalendarCard rows={today.appointmentsToday} status={today.appointmentsError ? 'Recorded appointments unavailable; loading calendar…' : 'Loading Google Calendar…'} />}>
            <TodayCalendar appointmentsError={today.appointmentsError} appointments={today.appointmentsToday} excludeIds={today.calendarEventIds ?? []} />
          </Suspense>

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
    </>
  )
}

export default async function AdminTodayPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const legacy = (Array.isArray(params.legacy) ? params.legacy[0] : params.legacy) === '1'
  const [auth, settings] = await Promise.all([getCachedClaims(), loadFirmSettings()])
  const legacyFallbackAvailable = !settings.commandCenterCutoverAt
  if (!settings.commandCenterV2Enabled || (legacy && legacyFallbackAvailable) || !auth) return <LegacyTodayPage />

  const now = new Date()
  const [graph, preferences] = await Promise.all([
    fetchWorkGraphForUser(auth.id, now),
    fetchWorkPreferences(auth.id),
  ])
  const preview = createDailyPlanPreview({
    items: graph.items,
    preferences,
    appointments: graph.appointments,
    now,
  })
  const stored = await fetchDailyPlan(auth.id, preview.date).catch(() => null)
  const calendarStatus = stored
    ? await getDailyPlanCalendarStatus(getAdminClient(), stored, graph.items).catch(() => null)
    : null
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: FIRM_TIMEZONE,
  }).format(now)

  return (
    <>
      <NavigationReady route="Today" />
      <CommandCenterTelemetry event="command_center_opened" />
      <AdminPageShell className="mx-auto w-full max-w-[1380px]">
        <PageHeader
          eyebrow="Daily command center"
          title={dateLabel}
          description="One plan across client work, deadlines, communications, calendar, billing, and automation."
          actions={legacyFallbackAvailable ? (
            <Link
              href="/admin?legacy=1"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View legacy Today
            </Link>
          ) : undefined}
        />
        <CommandCenter
          initialPreview={preview}
          preferences={preferences}
          initialPlan={stored ? { id: stored.id, status: stored.status, calendarStatus } : null}
          sourceErrors={graph.sourceErrors}
        />
      </AdminPageShell>
    </>
  )
}
