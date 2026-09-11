import * as google from '@/lib/appointments/googleEvents'
import * as outlook from '@/lib/appointments/legacyOutlookEvents'
import type { CalendarAttendee, CreateEventInput } from '@/lib/appointments/calendarTypes'
import { targetForAppointment, type CalendarTarget } from '@/lib/appointments/calendarTarget'

/**
 * One calendar for the booking flow to talk to.
 *
 * The firm's calendar is Google, and that is where every new appointment and
 * hold is written. The rule that still matters here is **"which calendar is
 * this particular event actually in"**: appointments booked before the
 * switchover carry a `microsoft_event_id`, and cancelling or moving one has to
 * go back to Outlook. Routing those to Google instead would orphan them —
 * which surfaces a week later as a client arriving for a meeting the attorney
 * believes they cancelled, and by then nothing points at the cause.
 */

export { CALENDAR_TARGET_LABEL } from '@/lib/appointments/calendarTarget'
export type { CalendarTarget } from '@/lib/appointments/calendarTarget'
export { targetForAppointment } from '@/lib/appointments/calendarTarget'

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

export function eventIdForAppointment(appointment: AppointmentEventIds): string | null {
  return appointment.google_event_id ?? appointment.microsoft_event_id ?? null
}

/**
 * Create the event for a new booking, or null when Google is not connected.
 *
 * A missing connection is not an error: the booking is kept and shows in admin
 * as an appointment with no calendar event, exactly as it did before.
 */
export async function createAppointmentEvent(
  input: CreateEventInput,
): Promise<CreatedCalendarEvent | null> {
  let created: { eventId: string; onlineMeetingUrl: string | null }
  try {
    created = await google.createCalendarEvent(input)
  } catch (err) {
    if (err instanceof Error && /not connected/i.test(err.message)) return null
    throw err
  }
  return { target: 'google', eventId: created.eventId, onlineMeetingUrl: created.onlineMeetingUrl }
}

export async function cancelAppointmentEvent(appointment: AppointmentEventIds): Promise<void> {
  const target = targetForAppointment(appointment)
  const eventId = eventIdForAppointment(appointment)
  if (!target || !eventId) return

  if (target === 'google') await google.cancelCalendarEvent(eventId)
  else await outlook.cancelCalendarEvent(eventId)
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
  else await outlook.rescheduleCalendarEvent(eventId, startIso, endIso)
}

/** RSVP state for an appointment's event, read from whichever calendar holds it. */
export async function appointmentEventAttendees(
  appointment: AppointmentEventIds,
): Promise<CalendarAttendee[]> {
  const target = targetForAppointment(appointment)
  const eventId = eventIdForAppointment(appointment)
  if (!target || !eventId) return []

  return target === 'google'
    ? google.getCalendarEventAttendees(eventId)
    : outlook.getCalendarEventAttendees(eventId)
}

/** The column an appointment's new event id belongs in. */
export function eventIdColumn(target: CalendarTarget): 'google_event_id' | 'microsoft_event_id' {
  return target === 'google' ? 'google_event_id' : 'microsoft_event_id'
}
