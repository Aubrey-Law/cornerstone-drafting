import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchCalendarBusy } from '@/lib/appointments/calendarBusy'
import { isSmsConfigured } from '@/lib/communications/config'
import { firmTodayKey } from '@/lib/firmDate'
import { fetchEmailTriageQueue, fetchTriageEnabled } from '@/lib/queries/emailTriage'
import { listSmsThreads } from '@/lib/queries/smsThreads'
import { fetchDueTasks } from '@/lib/queries/tasks'
import { fetchTodayData } from '@/lib/queries/today'
import {
  buildWorkGraph,
  type FailedAutomationRun,
  type FailedWorkflowJob,
} from '@/lib/work/buildWorkGraph'
import {
  DEFAULT_WORK_PREFERENCES,
  type WorkGraphResult,
  type WorkItemOverride,
  type WorkPreferences,
} from '@/lib/work/types'
import { addCalendarBusyToToday } from '@/lib/work/calendarBusy'

interface WorkPreferencesRow {
  max_must_do: number
  focus_capacity_minutes: number
  interruption_buffer_percent: number
  focus_block_minutes: number
  max_focus_block_minutes: number
  admin_batch_minutes: number
  workday_start: string
  workday_end: string
}

function normalizeTime(value: string | null | undefined, fallback: string): string {
  const match = /^(\d{2}:\d{2})/.exec(value ?? '')
  return match?.[1] ?? fallback
}

export async function fetchWorkPreferences(userId: string): Promise<WorkPreferences> {
  const { data, error } = await getAdminClient()
    .from('user_work_preferences')
    .select(
      'max_must_do, focus_capacity_minutes, interruption_buffer_percent, '
      + 'focus_block_minutes, max_focus_block_minutes, admin_batch_minutes, workday_start, workday_end',
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return DEFAULT_WORK_PREFERENCES
  const row = data as unknown as WorkPreferencesRow
  return {
    maxMustDo: row.max_must_do,
    focusCapacityMinutes: row.focus_capacity_minutes,
    interruptionBufferPercent: row.interruption_buffer_percent,
    focusBlockMinutes: row.focus_block_minutes,
    maxFocusBlockMinutes: row.max_focus_block_minutes,
    adminBatchMinutes: row.admin_batch_minutes === 15 ? 15 : 30,
    workdayStart: normalizeTime(row.workday_start, DEFAULT_WORK_PREFERENCES.workdayStart),
    workdayEnd: normalizeTime(row.workday_end, DEFAULT_WORK_PREFERENCES.workdayEnd),
  }
}

export async function fetchWorkOverrides(userId: string): Promise<WorkItemOverride[]> {
  const { data, error } = await getAdminClient()
    .from('work_item_overrides')
    .select('work_key, state, snoozed_until, assigned_to, note')
    .eq('user_id', userId)
  if (error) return []
  return (data ?? []) as unknown as WorkItemOverride[]
}

async function optionalSource<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T,
  errors: string[],
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    console.error(`work graph ${label} error`, error)
    errors.push(label)
    return fallback
  }
}

async function timedSource<T>(
  label: string,
  load: () => Promise<T>,
  durations: Record<string, number>,
): Promise<T> {
  const started = performance.now()
  try {
    return await load()
  } finally {
    durations[label] = Math.max(0, Math.round(performance.now() - started))
  }
}

export async function fetchWorkGraphForUser(
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<WorkGraphResult> {
  const sourceErrors: string[] = []
  const sourceDurationsMs: Record<string, number> = {}
  const through = new Date(now.getTime() + 5 * 86_400_000).toISOString()
  const todayKey = firmTodayKey(now)
  const firmNoonUtc = Date.parse(`${todayKey}T12:00:00Z`)
  const calendarFrom = new Date(firmNoonUtc - 18 * 60 * 60 * 1000)
  const calendarTo = new Date(firmNoonUtc + 18 * 60 * 60 * 1000)
  // Today and the canonical graph previously ran two identical due-task
  // queries (including their record-name enrichment). Share the wider read;
  // fetchTodayData still applies its exact firm-date grouping to this result.
  const futureTasksPromise = timedSource(
    'future_tasks',
    () => optionalSource('future_tasks', () => fetchDueTasks(through), [], sourceErrors),
    sourceDurationsMs,
  )

  const [today, calendarBusy, futureTasks, overrides, email, sms, failedWorkflowJobs, failedAutomationRuns] = await Promise.all([
    // The work graph must not synchronously enumerate every visible Google
    // calendar. One freeBusy request below supplies the planner with the same
    // blocking calendars while the database remains the source of obligations.
    timedSource('today', () => fetchTodayData({ includeCalendar: false, dueTasks: futureTasksPromise }), sourceDurationsMs),
    // Leave room inside the 1.5s API SLO for the database adapters. A slow
    // provider is reported as a source error rather than silently producing a
    // schedule that looks conflict-free.
    timedSource('calendar', () => optionalSource(
      'calendar',
      () => fetchCalendarBusy(calendarFrom, calendarTo, { timeoutMs: 900 }),
      [],
      sourceErrors,
    ), sourceDurationsMs),
    futureTasksPromise,
    timedSource('overrides', () => userId ? fetchWorkOverrides(userId) : Promise.resolve([]), sourceDurationsMs),
    timedSource('email', () => optionalSource('email', async () =>
      (await fetchTriageEnabled()) ? fetchEmailTriageQueue() : [], [], sourceErrors), sourceDurationsMs),
    timedSource('sms', () => optionalSource('sms', async () =>
      isSmsConfigured() ? listSmsThreads({ filter: 'unread', limit: 100 }) : [], [], sourceErrors), sourceDurationsMs),
    timedSource('automation_failures', () => optionalSource('automation_failures', async () => {
      const { data, error } = await getAdminClient()
        .from('workflow_jobs')
        .select('id, matter_id, job_type, updated_at')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as FailedWorkflowJob[]
    }, [], sourceErrors), sourceDurationsMs),
    timedSource('automation_rule_failures', () => optionalSource('automation_rule_failures', async () => {
      const admin = getAdminClient()
      const { data: rules, error: rulesError } = await admin
        .from('automation_rules')
        .select('id, system_key, last_success_at, last_failure_at')
        .not('last_failure_at', 'is', null)
      if (rulesError) throw rulesError
      const activelyFailed = (rules ?? []).filter(rule => (
        rule.last_failure_at && (!rule.last_success_at || rule.last_failure_at > rule.last_success_at)
      ))
      if (!activelyFailed.length) return []
      const { data, error } = await admin
        .from('automation_runs')
        .select('id, rule_id, system_key, status, error_summary, started_at')
        .in('rule_id', activelyFailed.map(rule => rule.id))
        .eq('status', 'failed')
        .order('started_at', { ascending: false })
        .limit(Math.max(100, activelyFailed.length * 2))
      if (error) throw error
      const latestByRule = new Map<string, FailedAutomationRun>()
      for (const row of (data ?? []) as FailedAutomationRun[]) {
        const key = row.rule_id ?? row.system_key ?? row.id
        if (!latestByRule.has(key)) latestByRule.set(key, row)
      }
      return [...latestByRule.values()]
    }, [], sourceErrors), sourceDurationsMs),
  ])

  return {
    ...buildWorkGraph({
      today: addCalendarBusyToToday(today, calendarBusy),
      futureTasks,
      overrides,
      email,
      sms,
      failedWorkflowJobs,
      failedAutomationRuns,
      sourceErrors,
    }, now),
    sourceDurationsMs,
  }
}
