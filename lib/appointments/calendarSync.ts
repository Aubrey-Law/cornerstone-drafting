import { getAnyConnectionForProvider } from '@/lib/calendarConnections'
import * as graph from '@/lib/appointments/graphEvents'
import * as google from '@/lib/appointments/googleEvents'
import type { CreateEventInput } from '@/lib/appointments/graphEvents'

/**
 * One calendar for the booking flow to talk to, whichever one the firm is on.
 *
 * The rule that matters here is not "which provider do we use" but **"which
 * calendar is this particular event actually in"**. Creating goes to whatever is
 * connected now; cancelling and rescheduling go back to wherever the event was
 * made, read off the appointment row. Routing those by the current provider
 * would orphan every appointment booked before a switchover — which surfaces a
 * week later as a client arriving for a meeting the attorney believes they
 * cancelled, and by then nothing points at the cause.
 */

export type CalendarTarget = 'google' | 'microsoft'

export interface CreatedCalendarEvent {
  target: CalendarTarget
  eventId: string
  onlineMeetingUrl: string | null
}

/** The event ids an appointment row can carry, one per calendar. */
export interface AppointmentEventIds {
  google_event_id?: string | null
  microsoft_event_id?: string | null
}

/**
 * Which calendar a new booking should go into.
 *
 * Google wins when connected, so the switchover is an OAuth consent rather than
 * a deploy. Returns null when neither is connected, which is not an error: the
 * booking is kept and the missing event shows in admin as an appointment with no
 * event id, exactly as it did before.
 */
export async function resolveCalendarTarget(): Promise<CalendarTarget | null> {
  if (await getAnyConnectionForProvider('google')) return 'google'
  if (await getAnyConnectionForProvider('microsoft')) return 'microsoft'
  return null
}

/** Where an existing event lives, or null when the booking never got one. */
export function targetForAppointment(appointment: AppointmentEventIds): CalendarTarget | null {
  if (appointment.google_event_id) return 'google'
  if (appointment.microsoft_event_id) return 'microsoft'
  return null
}

export function eventIdForAppointment(appointment: AppointmentEventIds): string | null {
  return appointment.google_event_id ?? appointment.microsoft_event_id ?? null
}

export async function createAppointmentEvent(
  input: CreateEventInput,
): Promise<CreatedCalendarEvent | null> {
  const target = await resolveCalendarTarget()
  if (!target) return null

  const created =
    target === 'google'
      ? await google.createCalendarEvent(input)
      : await graph.createCalendarEvent(input)

  return { target, eventId: created.eventId, onlineMeetingUrl: created.onlineMeetingUrl }
}

export async function cancelAppointmentEvent(appointment: AppointmentEventIds): Promise<void> {
  const target = targetForAppointment(appointment)
  const eventId = eventIdForAppointment(appointment)
  if (!target || !eventId) return

  if (target === 'google') await google.cancelCalendarEvent(eventId)
  else await graph.cancelCalendarEvent(eventId)
}

export async function rescheduleAppointmentEvent(
  appointment: AppointmentEventIds,
  startIso: string,
  endIso: string,
): Promise<void> {
  const target = targetForAppointment(appointment)
  const eventId = eventIdForAppointment(appointment)
  if (!target || !eventId) return

  if (target === 'google') await google.rescheduleCalendarEvent(eventId, startIso, endIso)
  else await graph.rescheduleCalendarEvent(eventId, startIso, endIso)
}

/** The column an appointment's new event id belongs in. */
export function eventIdColumn(target: CalendarTarget): 'google_event_id' | 'microsoft_event_id' {
  return target === 'google' ? 'google_event_id' : 'microsoft_event_id'
}
