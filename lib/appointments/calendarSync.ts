import * as google from '@/lib/appointments/googleEvents'
import type { CalendarAttendee, CreateEventInput } from '@/lib/appointments/calendarTypes'

/**
 * One calendar for the booking flow to talk to.
 *
 * The firm's calendar is Google, and that is where every appointment and hold
 * is written, cancelled, and moved. This module is the seam: the booking flow
 * states what should happen to an appointment's event and never which API
 * carries it out.
 */

export interface CreatedCalendarEvent {
  eventId: string
  onlineMeetingUrl: string | null
}

/** The event id an appointment row can carry. */
export interface AppointmentEventIds {
  google_event_id?: string | null
}

export function eventIdForAppointment(appointment: AppointmentEventIds): string | null {
  return appointment.google_event_id ?? null
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
  try {
    return await google.createCalendarEvent(input)
  } catch (err) {
    if (err instanceof Error && /not connected/i.test(err.message)) return null
    throw err
  }
}

export async function cancelAppointmentEvent(appointment: AppointmentEventIds): Promise<void> {
  const eventId = eventIdForAppointment(appointment)
  if (!eventId) return
  await google.cancelCalendarEvent(eventId)
}

export async function rescheduleAppointmentEvent(
  appointment: AppointmentEventIds,
  startIso: string,
  endIso: string,
): Promise<void> {
  const eventId = eventIdForAppointment(appointment)
  if (!eventId) return
  await google.rescheduleCalendarEvent(eventId, startIso, endIso)
}

/** Swap an appointment's event onto a Teams join link. No event, nothing to do. */
export async function attachTeamsMeetingToAppointmentEvent(
  appointment: AppointmentEventIds,
  joinUrl: string,
): Promise<void> {
  const eventId = eventIdForAppointment(appointment)
  if (!eventId) return
  await google.attachTeamsMeetingToCalendarEvent(eventId, joinUrl)
}

/** Replace the event's Teams link with a Google Meet; returns the Meet link, or null with no event. */
export async function attachGoogleMeetToAppointmentEvent(
  appointment: AppointmentEventIds,
): Promise<string | null> {
  const eventId = eventIdForAppointment(appointment)
  if (!eventId) return null
  return google.attachGoogleMeetToCalendarEvent(eventId)
}

/** RSVP state for an appointment's event. */
export async function appointmentEventAttendees(
  appointment: AppointmentEventIds,
): Promise<CalendarAttendee[]> {
  const eventId = eventIdForAppointment(appointment)
  if (!eventId) return []
  return google.getCalendarEventAttendees(eventId)
}
