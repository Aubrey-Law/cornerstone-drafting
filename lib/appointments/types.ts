import { type BookingQuestion, sanitizeBookingQuestions } from '@/lib/appointments/bookingQuestions'

export type AppointmentLocationType = 'phone' | 'teams' | 'in_person'

export const APPOINTMENT_LOCATION_TYPES: readonly AppointmentLocationType[] = [
  'phone',
  'teams',
  'in_person',
]

export const APPOINTMENT_LOCATION_LABELS: Record<AppointmentLocationType, string> = {
  phone: 'Phone call',
  teams: 'Virtual meeting',
  in_person: 'In person',
}

export function isAppointmentLocationType(value: unknown): value is AppointmentLocationType {
  return value === 'phone' || value === 'teams' || value === 'in_person'
}
export type AppointmentStatus = 'scheduled' | 'cancelled' | 'rescheduled' | 'no_show'
export type AppointmentSource = 'public' | 'portal' | 'admin' | 'calendly' | 'calcom' | 'lawmatics'

/**
 * Schedulers outside Cornerstone. Outbound sync does not push these rows
 * back, and their video link stays with that scheduler. Staff can still
 * remove or reschedule the Cornerstone copy when the meeting changes;
 * the next import from that scheduler wins if it still disagrees.
 */
const EXTERNAL_SOURCE_LABELS: Partial<Record<string, string>> = {
  calendly: 'Calendly',
  calcom: 'Cal.com',
  lawmatics: 'Lawmatics',
}

export function externalSourceLabel(source: string | null | undefined): string | null {
  return (source && EXTERNAL_SOURCE_LABELS[source]) || null
}

export function isExternallyManagedSource(source: string | null | undefined): boolean {
  return externalSourceLabel(source) !== null
}

export interface SchedulingSettings {
  timezone: string
  weeklyHours: WeeklyHours
  minNoticeHours: number
  horizonDays: number
  bufferMinutes: number
  /** Hours before the start time to email a reminder; 0 disables reminders. */
  reminderHoursBefore: number
  /** Pause all client-facing booking (staff bookings unaffected). */
  bookingPaused: boolean
  /** Also text the reminder when the attendee left a phone number. */
  smsRemindersEnabled: boolean
  /** Auto-send the intake invite when a lead books a discovery call. */
  autoIntakeInvite: boolean
  /** Per-date hour overrides ("YYYY-MM-DD" → windows; empty array = closed). */
  dateOverrides: Record<string, DayWindow[]>
  /** Calendly booking page URL per meeting type key; unset types have no link. */
  calendlyUrls: import('@/lib/calendly/links').CalendlyUrlMap
  /** Google calendar ids hidden from the admin calendar (primary is never hidden). */
  hiddenCalendarIds: string[]
  /** Google calendar ids that block client booking, in addition to primary. */
  blockingCalendarIds: string[]
}

/** Per-weekday bookable windows in the firm timezone ("HH:MM" 24h). */
export interface DayWindow {
  start: string
  end: string
}

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export type WeeklyHours = Record<Weekday, DayWindow[]>

export interface AppointmentType {
  id: string
  key: string
  slug: string
  label: string
  description: string
  durationMinutes: number
  /** Default format — always the first entry of locationTypes. */
  locationType: AppointmentLocationType
  /** Formats the client may choose from, in display order. */
  locationTypes: AppointmentLocationType[]
  active: boolean
  public: boolean
  sort: number
  /** When set, this type is only bookable inside these windows (firm TZ). */
  customWeeklyHours: WeeklyHours | null
  /** Extra questions the client answers when booking (in display order). */
  bookingQuestions: BookingQuestion[]
}

export interface AppointmentTypeRow {
  id: string
  key: string
  slug: string
  label: string
  description: string
  duration_minutes: number
  location_type: AppointmentLocationType
  location_types: unknown
  active: boolean
  public: boolean
  sort: number
  custom_weekly_hours: unknown
  booking_questions?: unknown
}

export interface AppointmentRow {
  id: string
  appointment_type_id: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  location_type: AppointmentLocationType | null
  attendee_name: string
  attendee_first_name?: string | null
  attendee_last_name?: string | null
  attendee_email: string
  attendee_phone: string | null
  second_attendee_name: string | null
  second_attendee_first_name?: string | null
  second_attendee_last_name?: string | null
  second_attendee_email: string | null
  notes: string | null
  linked_lead_id: string | null
  linked_matter_id: string | null
  booked_by_user_id: string | null
  google_event_id: string | null
  manage_token_hash: string | null
  manage_token_expires_at: string | null
  reminder_sent_at: string | null
  online_meeting_url: string | null
  online_meeting_provider?: 'google_meet' | 'microsoft_teams' | null
  teams_meeting_id?: string | null
  source: AppointmentSource
  external_booking_uid?: string | null
  created_at: string
  updated_at: string
}

export class BookingNameValidationError extends Error {}

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'])

/**
 * A best-effort first/last guess for a record that only has a display name,
 * used to prefill staff booking forms (which stay editable). The last word is
 * the last name, keeping a trailing suffix with it: "Mary Jane van Buren" →
 * "Mary Jane van" / "Buren" is a known miss staff can correct.
 */
export function splitDisplayName(name: string | null | undefined): { firstName: string; lastName: string } {
  const words = (name ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length < 2) return { firstName: words[0] ?? '', lastName: '' }
  const lastWords = words.length >= 3 && NAME_SUFFIXES.has(words[words.length - 1].toLowerCase()) ? 2 : 1
  return {
    firstName: words.slice(0, -lastWords).join(' '),
    lastName: words.slice(-lastWords).join(' '),
  }
}

/** New bookings require confirmed components; historical display names are never split server-side. */
export function normalizeBookingNames(input: {
  firstName: unknown
  lastName: unknown
  secondAttendeeFirstName?: unknown
  secondAttendeeLastName?: unknown
  secondAttendeeEmail?: unknown
}) {
  function component(value: unknown, field: string, required: boolean): string | null {
    const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    if ((value != null && typeof value !== 'string') || name.length > 80 || (required && !name)) {
      throw new BookingNameValidationError(`${field} must be a name between 1 and 80 characters`)
    }
    return name || null
  }
  const attendeeFirstName = component(input.firstName, 'firstName', true)!
  const attendeeLastName = component(input.lastName, 'lastName', true)!
  const secondAttendeeFirstName = component(input.secondAttendeeFirstName, 'secondAttendeeFirstName', false)
  const secondAttendeeLastName = component(input.secondAttendeeLastName, 'secondAttendeeLastName', false)
  const hasSecondEmail = typeof input.secondAttendeeEmail === 'string' && Boolean(input.secondAttendeeEmail.trim())
  if ((secondAttendeeFirstName || secondAttendeeLastName || hasSecondEmail) && !(secondAttendeeFirstName && secondAttendeeLastName)) {
    throw new BookingNameValidationError('Both secondAttendeeFirstName and secondAttendeeLastName are required for a second attendee name')
  }
  return {
    attendeeFirstName, attendeeLastName,
    attendeeName: `${attendeeFirstName} ${attendeeLastName}`,
    secondAttendeeFirstName, secondAttendeeLastName,
    secondAttendeeName: secondAttendeeFirstName && secondAttendeeLastName ? `${secondAttendeeFirstName} ${secondAttendeeLastName}` : null,
  }
}

/** Half-open UTC interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number
  end: number
}

export function appointmentTypeFromRow(row: AppointmentTypeRow): AppointmentType {
  const locationTypes = sanitizeLocationTypes(row.location_types, row.location_type)
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    label: row.label,
    description: row.description,
    durationMinutes: row.duration_minutes,
    locationType: locationTypes[0],
    locationTypes,
    active: row.active,
    public: row.public,
    sort: row.sort,
    customWeeklyHours: sanitizeCustomWeeklyHours(row.custom_weekly_hours),
    bookingQuestions: sanitizeBookingQuestions(row.booking_questions),
  }
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Per-date hour overrides: "YYYY-MM-DD" → bookable windows for that date.
 * An empty array means closed all day. Invalid keys/windows are dropped.
 */
export function sanitizeDateOverrides(value: unknown): Record<string, DayWindow[]> {
  const result: Record<string, DayWindow[]> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, windows] of Object.entries(value as Record<string, unknown>)) {
    if (!DATE_KEY_RE.test(key)) continue
    if (!Array.isArray(windows)) continue
    // Reuse the single-window sanitizer via a one-day WeeklyHours pass.
    const sanitized = sanitizeWeeklyHours({ mon: windows }).mon
    result[key] = sanitized
  }
  return result
}

/** Dedupe and validate an allowed-formats list; falls back to the legacy single format. */
export function sanitizeLocationTypes(
  value: unknown,
  fallback: AppointmentLocationType,
): AppointmentLocationType[] {
  const list = Array.isArray(value) ? value.filter(isAppointmentLocationType) : []
  const deduped = [...new Set(list)]
  return deduped.length > 0
    ? deduped
    : [isAppointmentLocationType(fallback) ? fallback : 'phone']
}

/** The format a specific appointment uses (stored choice, else type default). */
export function resolveLocationType(
  chosen: unknown,
  type: Pick<AppointmentType, 'locationType' | 'locationTypes'>,
): AppointmentLocationType {
  return isAppointmentLocationType(chosen) && type.locationTypes.includes(chosen)
    ? chosen
    : type.locationType
}

function sanitizeWindow(value: unknown): DayWindow | null {
  if (!value || typeof value !== 'object') return null
  const { start, end } = value as { start?: unknown; end?: unknown }
  if (typeof start !== 'string' || typeof end !== 'string') return null
  const re = /^\d{1,2}:\d{2}$/
  if (!re.test(start.trim()) || !re.test(end.trim())) return null
  return { start: start.trim(), end: end.trim() }
}

export function sanitizeWeeklyHours(value: unknown): WeeklyHours {
  const result = emptyWeeklyHours()
  if (!value || typeof value !== 'object') return result
  for (const day of WEEKDAYS) {
    const windows = (value as Record<string, unknown>)[day]
    if (!Array.isArray(windows)) continue
    result[day] = windows
      .map(sanitizeWindow)
      .filter((w): w is DayWindow => w !== null)
  }
  return result
}

/**
 * Per-type hours: null/invalid → null (use general hours). An object with no
 * valid windows also maps to null so a malformed value can never silently make
 * a type unbookable.
 */
export function sanitizeCustomWeeklyHours(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== 'object') return null
  const hours = sanitizeWeeklyHours(value)
  const hasWindows = WEEKDAYS.some(day => hours[day].length > 0)
  return hasWindows ? hours : null
}

/** The weekly hours a given type is bookable in. */
export function effectiveWeeklyHours(
  general: WeeklyHours,
  type: Pick<AppointmentType, 'customWeeklyHours'>,
): WeeklyHours {
  return type.customWeeklyHours ?? general
}

export const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function emptyWeeklyHours(): WeeklyHours {
  return { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }
}
