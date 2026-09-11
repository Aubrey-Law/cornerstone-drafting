import 'server-only'
import { getCalendarEventTimes } from './googleEvents'
import type { CalendarEventTimes } from './calendarTypes'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Inbound half of the Google Calendar two-way sync.
 *
 * Cornerstone already pushes bookings out to Google (create / reschedule /
 * cancel). Edits made in Google Calendar itself never came back, so an
 * appointment the attorney dragged to a new time — or deleted — kept its
 * original row here and was *hidden* from the calendar overlay (it is excluded
 * by `google_event_id`), leaving the app showing a meeting that no longer
 * exists at that time. This module mirrors those calendar-side edits back onto
 * the `appointments` row so both calendars agree.
 *
 * Google stays the source of truth for time and existence; the app keeps
 * owning everything else (matter link, attendee data, type). Nothing here
 * writes back out to Google or emails anyone — the change already happened
 * there, and Google has already notified the attendees.
 */

export interface ReconcilableAppointment {
  id: string
  start_time: string
  end_time: string
  status: string
  google_event_id: string | null
}

export type ReconcileAction =
  | { appointmentId: string; eventId: string; kind: 'move'; startIso: string; endIso: string }
  | { appointmentId: string; eventId: string; kind: 'cancel' }
  /** Not in the fetched range — could be moved out of view, or deleted. */
  | { appointmentId: string; eventId: string; kind: 'recheck' }

/** Google and Postgres round differently; sub-minute drift is not a move. */
const DRIFT_TOLERANCE_MS = 60_000

/** Cap on direct per-event calendar lookups for one reconciliation pass. */
const MAX_RECHECKS = 25

function driftsFrom(appointment: ReconcilableAppointment, event: CalendarEventTimes): boolean {
  const startDrift = Math.abs(Date.parse(appointment.start_time) - Date.parse(event.startIso))
  const endDrift = Math.abs(Date.parse(appointment.end_time) - Date.parse(event.endIso))
  if (!Number.isFinite(startDrift) || !Number.isFinite(endDrift)) return false
  return startDrift > DRIFT_TOLERANCE_MS || endDrift > DRIFT_TOLERANCE_MS
}

/**
 * Decide what each Cornerstone appointment needs, given the calendar events
 * read for the same range. Pure — the Google and database calls live in
 * `reconcileAppointmentsFromCalendar`.
 */
export function planCalendarReconciliation(
  appointments: readonly ReconcilableAppointment[],
  eventsById: ReadonlyMap<string, CalendarEventTimes>,
): ReconcileAction[] {
  const actions: ReconcileAction[] = []
  for (const appointment of appointments) {
    const eventId = appointment.google_event_id
    // Only live bookings the calendar actually owns an event for.
    if (!eventId || appointment.status !== 'scheduled') continue

    const event = eventsById.get(eventId)
    if (!event) {
      actions.push({ appointmentId: appointment.id, eventId, kind: 'recheck' })
      continue
    }
    if (event.isCancelled) {
      actions.push({ appointmentId: appointment.id, eventId, kind: 'cancel' })
      continue
    }
    if (driftsFrom(appointment, event)) {
      actions.push({
        appointmentId: appointment.id,
        eventId,
        kind: 'move',
        startIso: event.startIso,
        endIso: event.endIso,
      })
    }
  }
  return actions
}

export interface ReconcileSummary {
  moved: number
  cancelled: number
  /** Actions that could not be applied (a calendar error, or a time collision). */
  failed: number
}

async function applyMove(
  appointmentId: string,
  startIso: string,
  endIso: string,
): Promise<boolean> {
  const { error } = await getAdminClient()
    .from('appointments')
    .update({ start_time: startIso, end_time: endIso, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('status', 'scheduled')
  if (error) {
    // `appointments_no_overlap` rejects a move onto another live booking. The
    // calendar event is still the truth; surface it rather than failing the view.
    console.error('[appointments] calendar move write failed for', appointmentId, error.message)
    return false
  }
  return true
}

async function applyCancel(appointmentId: string): Promise<boolean> {
  const { error } = await getAdminClient()
    .from('appointments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('status', 'scheduled')
  if (error) {
    console.error('[appointments] calendar cancel write failed for', appointmentId, error.message)
    return false
  }
  return true
}

/**
 * Resolve a `recheck` with a direct calendar lookup: a 404 means the event was
 * deleted in Google, anything else means it simply moved out of the range we
 * read. Returns null when the lookup itself failed — the appointment is then
 * left untouched, because "we could not ask" must never read as "it was
 * deleted".
 */
async function resolveRecheck(
  action: Extract<ReconcileAction, { kind: 'recheck' }>,
  appointment: ReconcilableAppointment,
): Promise<ReconcileAction | null> {
  let event: CalendarEventTimes | null
  try {
    event = await getCalendarEventTimes(action.eventId)
  } catch (err) {
    console.error('[appointments] calendar recheck failed for', action.appointmentId, err)
    return null
  }
  if (!event || event.isCancelled) {
    return { appointmentId: action.appointmentId, eventId: action.eventId, kind: 'cancel' }
  }
  if (!driftsFrom(appointment, event)) return null
  return {
    appointmentId: action.appointmentId,
    eventId: action.eventId,
    kind: 'move',
    startIso: event.startIso,
    endIso: event.endIso,
  }
}

/**
 * Mirror calendar-side moves and deletions onto the appointments in a range.
 * Best-effort: any failure is logged and counted, never thrown, so a calendar
 * load never fails on reconciliation.
 */
export async function reconcileAppointmentsFromCalendar(
  appointments: readonly ReconcilableAppointment[],
  eventsById: ReadonlyMap<string, CalendarEventTimes>,
): Promise<ReconcileSummary> {
  const byId = new Map(appointments.map(row => [row.id, row]))
  const planned = planCalendarReconciliation(appointments, eventsById)
  const summary: ReconcileSummary = { moved: 0, cancelled: 0, failed: 0 }
  if (planned.length === 0) return summary

  const direct = planned.filter(action => action.kind !== 'recheck')
  const rechecks = planned.filter(
    (action): action is Extract<ReconcileAction, { kind: 'recheck' }> => action.kind === 'recheck',
  )
  if (rechecks.length > MAX_RECHECKS) {
    console.warn(
      `[appointments] ${rechecks.length} calendar rechecks pending; resolving the first ${MAX_RECHECKS}`,
    )
  }

  const resolved = await Promise.all(
    rechecks.slice(0, MAX_RECHECKS).map(async action => {
      const appointment = byId.get(action.appointmentId)
      return appointment ? resolveRecheck(action, appointment) : null
    }),
  )

  const pending = [...direct, ...resolved.flatMap(action => (action ? [action] : []))]

  for (const action of pending) {
    if (action.kind === 'move') {
      const ok = await applyMove(action.appointmentId, action.startIso, action.endIso)
      if (ok) summary.moved += 1
      else summary.failed += 1
    } else if (action.kind === 'cancel') {
      const ok = await applyCancel(action.appointmentId)
      if (ok) summary.cancelled += 1
      else summary.failed += 1
    }
  }
  return summary
}
