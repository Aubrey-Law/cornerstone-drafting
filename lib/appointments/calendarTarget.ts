/**
 * Which calendar the firm writes a new appointment to.
 *
 * Its own module, with no imports, because both the booking flow and the
 * settings screen need the rule and they run on opposite sides of the network.
 * `calendarSync` reaches Supabase and the two calendar APIs; importing it from a
 * client component would pull the service-role client into the browser bundle.
 */

export type CalendarTarget = 'google' | 'microsoft'

/**
 * Google wins when connected, so the switchover is an OAuth consent rather than
 * a deploy. Null means nothing is connected — not an error: the booking is kept
 * and shows in admin as an appointment with no calendar event.
 */
export function preferredTarget(connected: {
  google: boolean
  microsoft: boolean
}): CalendarTarget | null {
  if (connected.google) return 'google'
  if (connected.microsoft) return 'microsoft'
  return null
}

/** What to call each calendar in front of the attorney. */
export const CALENDAR_TARGET_LABEL: Record<CalendarTarget | 'none', string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook',
  none: 'no calendar — nothing is connected',
}
