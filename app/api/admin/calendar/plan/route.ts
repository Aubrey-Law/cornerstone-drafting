import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listCalendarView, mapGraphCalendarView } from '@/lib/appointments/graphEvents'
import { aggregateWorkload, nextWorkingDateKeys } from '@/lib/calendarProductivity'
import type { CalendarWorkEvent } from '@/lib/calendarProductivity'
import { FIRM_TIMEZONE, firmTodayKey } from '@/lib/firmDate'
import { fetchDueTasks, fetchTasks } from '@/lib/queries/tasks'
import { effectiveDueAt, taskDueGroup } from '@/lib/tasks/types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadFirmSettings } from '@/lib/firmSettings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const requested = req.nextUrl.searchParams.get('from')
  const from = Number.isFinite(Date.parse(requested ?? '')) ? new Date(requested!) : new Date()
  const dates = nextWorkingDateKeys(from, 10, FIRM_TIMEZONE)
  const rangeFrom = new Date(`${dates[0]}T00:00:00-04:00`)
  const rangeTo = new Date(`${dates[dates.length - 1]}T23:59:59-05:00`)
  const lastWeekFrom = new Date(rangeFrom.getTime() - 7 * 86_400_000)
  const admin = getAdminClient()

  const [appointmentResult, tasks, undatedTasks, firmSettings, lastWeekResult, stageResult] = await Promise.all([
    admin
      .from('appointments')
      .select('id, start_time, end_time, status, linked_matter_id, appointment_type_id, microsoft_event_id')
      .gte('start_time', rangeFrom.toISOString())
      .lte('start_time', rangeTo.toISOString()),
    // Two exact reads where one capped read used to stand in for both: the
    // deadlines and what slipped are due on or before the end of the window,
    // and the unscheduled work is the tasks with an estimate and no date at
    // all. 1,000 was already below the 1,024 open tasks this read walked.
    fetchDueTasks(rangeTo.toISOString()),
    fetchTasks({ status: 'open', undated: true, hasEstimate: true, all: true }),
    loadFirmSettings(),
    admin
      .from('appointments')
      .select('id, start_time, end_time, status, linked_matter_id')
      .gte('start_time', lastWeekFrom.toISOString())
      .lt('start_time', rangeFrom.toISOString()),
    admin
      .from('matter_activity')
      .select('matter_id, event_type, created_at')
      .eq('event_type', 'stage_changed')
      .gte('created_at', lastWeekFrom.toISOString())
      .lt('created_at', rangeFrom.toISOString()),
  ])
  const appointments = appointmentResult.data ?? []
  const targetMinutes = firmSettings.calendarDailyTargetMinutes
  const workEvents: CalendarWorkEvent[] = appointments
    .filter(row => row.status === 'scheduled')
    .map(row => ({ startIso: row.start_time, endIso: row.end_time, kind: 'client' as const }))

  let connected = true
  try {
    const exclude = new Set(
      appointments.map(row => row.microsoft_event_id).filter((id): id is string => Boolean(id)),
    )
    const view = await listCalendarView(rangeFrom.toISOString(), rangeTo.toISOString())
    const outlook = mapGraphCalendarView(view.raw, exclude)
    workEvents.push(...outlook
      .filter(event => !event.isAllDay)
      .map(event => ({ startIso: event.startIso, endIso: event.endIso, kind: 'internal' as const })))
  } catch {
    connected = false
  }

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
    days: aggregateWorkload(dates, workEvents, targetMinutes, firmTodayKey()),
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
