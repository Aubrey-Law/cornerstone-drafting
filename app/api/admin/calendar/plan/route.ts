import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listCalendarView, mapCalendarView } from '@/lib/appointments/googleEvents'
import { aggregateWorkload, nextWorkingDateKeys } from '@/lib/calendarProductivity'
import type { CalendarWorkEvent } from '@/lib/calendarProductivity'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import { calendarAnchorDate } from '@/lib/calendarDay'
import { dateInstant, nextDateKey } from '@/lib/calendarAvailability'
import { fetchDueTasks, fetchTasks } from '@/lib/queries/tasks'
import { effectiveDueAt, taskDueGroup } from '@/lib/tasks/types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchWorkGraphForUser, fetchWorkPreferences } from '@/lib/work/server'
import { createDailyPlanPreview } from '@/lib/work/planner'
import { fetchDailyPlan } from '@/lib/work/plans'
import { buildCalendarTodayPlan } from '@/lib/work/calendarPlan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { timezone } = await getSchedulingSettings()
  const requested = req.nextUrl.searchParams.get('from')
  const from = Number.isFinite(Date.parse(requested ?? '')) ? new Date(requested!) : new Date()
  const requestedTo = req.nextUrl.searchParams.get('to')
  let dates = nextWorkingDateKeys(from, 10, timezone)
  if (requestedTo) {
    const startKey = req.nextUrl.searchParams.get('from') ?? ''
    if (!Number.isFinite(calendarAnchorDate(startKey, new Date(NaN)).getTime()) || !Number.isFinite(calendarAnchorDate(requestedTo, new Date(NaN)).getTime()) || requestedTo <= startKey || Date.parse(requestedTo) - Date.parse(startKey) > 42 * 86_400_000) return NextResponse.json({ error: 'Valid date range required (maximum 42 days)' }, { status: 400 })
    dates = []
    for (let key = startKey; key < requestedTo; key = nextDateKey(key)) dates.push(key)
  }
  const rangeFrom = new Date(dateInstant(dates[0], timezone))
  const rangeTo = new Date(dateInstant(nextDateKey(dates[dates.length - 1]), timezone))
  const lastWeekFrom = new Date(dateInstant(nextDateKey(dates[0], -7), timezone))
  const workloadOnly = req.nextUrl.searchParams.get('workload') === '1'
  const admin = getAdminClient()
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: timezone })

  const [appointmentResult, tasks, undatedTasks, firmSettings, lastWeekResult, stageResult, workGraph, workPreferences, storedPlan] = await Promise.all([
    admin
      .from('appointments')
      .select('id, start_time, end_time, status, linked_matter_id, appointment_type_id, google_event_id')
      .gte('start_time', rangeFrom.toISOString())
      .lt('start_time', rangeTo.toISOString()),
    // Two exact reads where one capped read used to stand in for both: the
    // deadlines and what slipped are due on or before the end of the window,
    // and the unscheduled work is the tasks with an estimate and no date at
    // all. 1,000 was already below the 1,024 open tasks this read walked.
    workloadOnly ? Promise.resolve([]) : fetchDueTasks(rangeTo.toISOString()),
    workloadOnly ? Promise.resolve([]) : fetchTasks({ status: 'open', undated: true, hasEstimate: true, all: true }),
    loadFirmSettings(),
    workloadOnly ? Promise.resolve({ data: [] }) : admin
      .from('appointments')
      .select('id, start_time, end_time, status, linked_matter_id')
      .gte('start_time', lastWeekFrom.toISOString())
      .lt('start_time', rangeFrom.toISOString()),
    workloadOnly ? Promise.resolve({ data: [] }) : admin
      .from('matter_activity')
      .select('matter_id, event_type, created_at')
      .eq('event_type', 'stage_changed')
      .gte('created_at', lastWeekFrom.toISOString())
      .lt('created_at', rangeFrom.toISOString()),
    workloadOnly ? Promise.resolve(null) : fetchWorkGraphForUser(auth.userId),
    workloadOnly ? Promise.resolve(null) : fetchWorkPreferences(auth.userId),
    workloadOnly ? Promise.resolve(null) : fetchDailyPlan(auth.userId, todayKey),
  ])
  if (appointmentResult.error) return NextResponse.json({ error: 'Workload unavailable' }, { status: 500 })
  const appointments = appointmentResult.data ?? []
  const targetMinutes = firmSettings.calendarDailyTargetMinutes
  const workEvents: CalendarWorkEvent[] = appointments
    .filter(row => row.status === 'scheduled')
    .map(row => ({ startIso: row.start_time, endIso: row.end_time, kind: 'client' as const }))

  // Partial Google results stay unpublished so a missing calendar cannot look like a light day.
  // A disconnected account still publishes Cornerstone appointments, labeled as local-only.
  let googleStatus: 'included' | 'unavailable' | 'partial' = 'included'
  try {
    const exclude = new Set(
      appointments
        .flatMap(row => [row.google_event_id])
        .filter((id): id is string => Boolean(id)),
    )
    const view = await listCalendarView(rangeFrom.toISOString(), rangeTo.toISOString())
    if (view.truncated || view.skipped.length > 0) {
      googleStatus = 'partial'
    } else {
      const calendarEvents = mapCalendarView(view.raw, exclude)
      workEvents.push(...calendarEvents
        .filter(event => !event.isAllDay)
        .map(event => ({ startIso: event.startIso, endIso: event.endIso, kind: 'internal' as const })))
    }
  } catch {
    googleStatus = 'unavailable'
  }

  const connected = googleStatus === 'included'
  const days = googleStatus === 'partial' ? [] : aggregateWorkload(dates, workEvents, targetMinutes, todayKey, timezone)
  if (workloadOnly) return NextResponse.json({ connected, googleStatus, days })
  if (!workGraph || !workPreferences) return NextResponse.json({ error: 'Plan unavailable' }, { status: 500 })

  const deadlines = tasks
    .map(task => ({ task, date: effectiveDueAt(task) }))
    .filter((row): row is { task: typeof tasks[number]; date: string } => Boolean(row.date))
    .filter(row => row.date >= rangeFrom.toISOString() && row.date <= rangeTo.toISOString())
    .map(({ task, date }) => ({
      id: task.id,
      date,
      label: task.title,
      matterId: task.matter_id,
      leadId: task.lead_id,
      durationMinutes: task.estimate_minutes ?? 30,
    }))
  const unscheduledTasks = undatedTasks
    .filter(task => task.estimate_minutes && !effectiveDueAt(task))
    .map(task => ({
      id: task.id,
      title: task.title,
      estimateMinutes: task.estimate_minutes ?? 30,
      matterId: task.matter_id,
      leadId: task.lead_id,
    }))

  const lastWeek = lastWeekResult.data ?? []
  const matterIdsWithMeetings = [...new Set(lastWeek
    .map(row => row.linked_matter_id)
    .filter((id): id is string => Boolean(id)))]
  const notesResult = matterIdsWithMeetings.length
    ? await admin
      .from('matter_notes')
      .select('matter_id, created_at')
      .in('matter_id', matterIdsWithMeetings)
      .gte('created_at', lastWeekFrom.toISOString())
    : { data: [] }
  const notedMatters = new Set((notesResult.data ?? []).map(row => row.matter_id))
  const slipped = tasks
    .filter(task => taskDueGroup(task) === 'overdue')
    .slice(0, 6)
    .map(task => task.title)

  return NextResponse.json({
    connected,
    googleStatus,
    days,
    today: buildCalendarTodayPlan({
      items: workGraph.items,
      preview: createDailyPlanPreview({
        items: workGraph.items,
        appointments: workGraph.appointments,
        preferences: workPreferences,
        date: todayKey,
      }),
      stored: storedPlan,
    }),
    deadlines,
    unscheduledTasks,
    review: {
      meetingsHeld: lastWeek.filter(row => row.status === 'scheduled' && Date.parse(row.end_time) < Date.now()).length,
      noShows: lastWeek.filter(row => row.status === 'no_show').length,
      mattersAdvanced: new Set((stageResult.data ?? []).map(row => row.matter_id)).size,
      notesMissing: matterIdsWithMeetings.filter(id => !notedMatters.has(id)).length,
      slipped,
    },
  })
}
