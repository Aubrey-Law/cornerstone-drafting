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
export type AppointmentStatus = 'scheduled' | 'cancelled' | 'rescheduled'
export type AppointmentSource = 'public' | 'portal' | 'admin'

export interface SchedulingSettings {
  timezone: string
  weeklyHours: WeeklyHours
  minNoticeHours: number
  horizonDays: number
  bufferMinutes: number
  /** Hours before the start time to email a reminder; 0 disables reminders. */
  reminderHoursBefore: number
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
}

export interface AppointmentRow {
  id: string
  appointment_type_id: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  location_type: AppointmentLocationType | null
  attendee_name: string
  attendee_email: string
  attendee_phone: string | null
  notes: string | null
  linked_lead_id: string | null
  linked_matter_id: string | null
  booked_by_user_id: string | null
  microsoft_event_id: string | null
  manage_token_hash: string | null
  manage_token_expires_at: string | null
  reminder_sent_at: string | null
  online_meeting_url: string | null
  source: AppointmentSource
  created_at: string
  updated_at: string
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
  }
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
