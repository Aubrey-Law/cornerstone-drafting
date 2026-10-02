import type { BookingAnswer } from './bookingQuestions'
import type { AppointmentType } from './types'

/**
 * The shapes the app reads and writes calendars in.
 *
 * Its own module, with no runtime imports, so the UI can render these without
 * pulling in the Google client that produces them.
 */

export interface CreateEventInput {
  type: AppointmentType
  startIso: string
  endIso: string
  attendeeName: string
  attendeeEmail: string
  attendeePhone?: string | null
  secondAttendeeName?: string | null
  secondAttendeeEmail?: string | null
  notes?: string | null
  /** Answers to the type's booking questions, shown in the event description. */
  bookingAnswers?: BookingAnswer[]
  /** In-person location line (office address) when locationType = in_person. */
  officeAddress?: string | null
  /**
   * A Teams join link created before the event. When set, the event carries
   * it as its location and no Google Meet is requested.
   */
  teamsJoinUrl?: string | null
}

export type OnlineMeetingProvider = 'google_meet' | 'microsoft_teams'

export interface CreatedEvent {
  eventId: string
  onlineMeetingUrl: string | null
}

/** An event on one of the firm's calendars, as the admin calendar renders it. */
export interface CalendarEvent {
  id: string
  subject: string
  startIso: string
  endIso: string
  isAllDay: boolean
  /** Free/busy status: 'free' or 'busy'. */
  showAs: string
  /** Id of the calendar the event lives on. */
  calendarId?: string | null
  /** Display name of that calendar ("Aubrey Law", "Court dates", a shared one…). */
  calendarName?: string | null
}

/** Just the timing of one event — what reconciliation compares against. */
export interface CalendarEventTimes {
  id: string
  startIso: string
  endIso: string
  isCancelled: boolean
}

/** One calendar in the connected account. */
export interface CalendarRef {
  id: string
  name: string
  isDefault: boolean
}

export interface CalendarViewResult {
  /** Raw provider events, each tagged with the calendar it came from. */
  raw: unknown[]
  /** Calendars actually read, primary first. */
  calendars: CalendarRef[]
  /** True when a calendar had more pages than we read — events were left out. */
  truncated: boolean
  /** Names of calendars the provider would not serve, or we ran out of time for. */
  skipped: string[]
}

export interface CalendarAttendee {
  name: string
  email: string
  status: string
}
