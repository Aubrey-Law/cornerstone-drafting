/**
 * Which calendar an appointment's event lives in.
 *
 * Its own module, with no imports, because both the booking flow and the
 * settings screen need the rule and they run on opposite sides of the network.
 * `calendarSync` reaches Supabase and the calendar APIs; importing it from a
 * client component would pull the service-role client into the browser bundle.
 */

export type CalendarTarget = 'google' | 'microsoft'

/** Where every new booking and hold is written. */
export const NEW_EVENT_TARGET: CalendarTarget = 'google'

/**
 * Where an existing event lives, or null when the booking never got one.
 *
 * Read off the appointment row rather than from the firm's current provider:
 * bookings made before the firm left Microsoft 365 still hold an Outlook
 * event, and that is the only calendar that can cancel or move them.
 */
export function targetForAppointment(appointment: {
  google_event_id?: string | null
  microsoft_event_id?: string | null
}): CalendarTarget | null {
  if (appointment.google_event_id) return 'google'
  if (appointment.microsoft_event_id) return 'microsoft'
  return null
}

/** What to call each calendar in front of the attorney. */
export const CALENDAR_TARGET_LABEL: Record<CalendarTarget | 'none', string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook (legacy)',
  none: 'no calendar — nothing is connected',
}
