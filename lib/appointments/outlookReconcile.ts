import 'server-only'
import { getCalendarEventTimes, type OutlookEventTimes } from './graphEvents'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Inbound half of the Outlook two-way sync.
 *
 * Cornerstone already pushes bookings out to Outlook (create / reschedule /
 * cancel). Edits made in Outlook itself never came back, so an appointment the
 * attorney dragged to a new time — or deleted — kept its original row here and
 * was *hidden* from the Outlook overlay (it is excluded by
 * `microsoft_event_id`), leaving the app showing a meeting that no longer
 * exists at that time. This module mirrors those Outlook-side edits back onto
 * the `appointments` row so both calendars agree.
 *
 * Outlook stays the source of truth for time and existence; the app keeps
 * owning everything else (matter link, attendee data, type). Nothing here
 * writes back out to Graph or emails anyone — the change already happened in
 * Outlook, and Outlook has already notified the attendees.
 */

export interface ReconcilableAppointment {
  id: string
  start_time: string
  end_time: string
  status: string
  microsoft_event_id: string | null
}

export type ReconcileAction =
  | { appointmentId: string; eventId: string; kind: 'move'; startIso: string; endIso: string }
  | { appointmentId: string; eventId: string; kind: 'cancel' }
  /** Not in the fetched range — could be moved out of view, or deleted. */
  | { appointmentId: string; eventId: string; kind: 'recheck' }

/** Graph and Postgres round differently; sub-minute drift is not a move. */
const DRIFT_TOLERANCE_MS = 60_000

/** Cap on direct per-event Graph lookups for one reconciliation pass. */
const MAX_RECHECKS = 25

function driftsFrom(appointment: ReconcilableAppointment, event: OutlookEventTimes): boolean {
  const startDrift = Math.abs(Date.parse(appointment.start_time) - Date.parse(event.startIso))
  const endDrift = Math.abs(Date.parse(appointment.end_time) - Date.parse(event.endIso))
  if (!Number.isFinite(startDrift) || !Number.isFinite(endDrift)) return false
  return startDrift > DRIFT_TOLERANCE_MS || endDrift > DRIFT_TOLERANCE_MS
}

/**
 * Decide what each Cornerstone appointment needs, given the Outlook events
 * read for the same range. Pure — the Graph and database calls live in
 * `reconcileAppointmentsFromOutlook`.
 */
export function planOutlookReconciliation(
  appointments: readonly ReconcilableAppointment[],
  eventsById: ReadonlyMap<string, OutlookEventTimes>,
): ReconcileAction[] {
  const actions: ReconcileAction[] = []
  for (const appointment of appointments) {
    const eventId = appointment.microsoft_event_id
    // Only live bookings that Outlook actually owns an event for.
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
  /** Actions that could not be applied (Graph error, or a time collision). */
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
    // Outlook event is still the truth; surface it rather than failing the view.
    console.error('[appointments] outlook move write failed for', appointmentId, error.message)
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
    console.error('[appointments] outlook cancel write failed for', appointmentId, error.message)
    return false
  }
  return true
}

/**
 * Resolve a `recheck` with a direct Graph lookup: a 404 means the event was
 * deleted in Outlook, anything else means it simply moved out of the range we
 * read. Returns null when Graph itself failed — the appointment is then left
 * untouched, because "we could not ask" must never read as "it was deleted".
 */
async function resolveRecheck(
  action: Extract<ReconcileAction, { kind: 'recheck' }>,
  appointment: ReconcilableAppointment,
): Promise<ReconcileAction | null> {
  let event: OutlookEventTimes | null
  try {
    event = await getCalendarEventTimes(action.eventId)
  } catch (err) {
    console.error('[appointments] outlook recheck failed for', action.appointmentId, err)
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
 * Mirror Outlook-side moves and deletions onto the appointments in a range.
 * Best-effort: any failure is logged and counted, never thrown, so a calendar
 * load never fails on reconciliation.
 */
export async function reconcileAppointmentsFromOutlook(
  appointments: readonly ReconcilableAppointment[],
  eventsById: ReadonlyMap<string, OutlookEventTimes>,
): Promise<ReconcileSummary> {
  const byId = new Map(appointments.map(row => [row.id, row]))
  const planned = planOutlookReconciliation(appointments, eventsById)
  const summary: ReconcileSummary = { moved: 0, cancelled: 0, failed: 0 }
  if (planned.length === 0) return summary

  const direct = planned.filter(action => action.kind !== 'recheck')
  const rechecks = planned.filter(
    (action): action is Extract<ReconcileAction, { kind: 'recheck' }> => action.kind === 'recheck',
  )
  if (rechecks.length > MAX_RECHECKS) {
    console.warn(
      `[appointments] ${rechecks.length} Outlook rechecks pending; resolving the first ${MAX_RECHECKS}`,
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
