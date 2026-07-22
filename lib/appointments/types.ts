export type AppointmentLocationType = 'phone' | 'teams' | 'in_person'
export type AppointmentStatus = 'scheduled' | 'cancelled' | 'rescheduled'
export type AppointmentSource = 'public' | 'portal'

export interface SchedulingSettings {
  timezone: string
  weeklyHours: WeeklyHours
  minNoticeHours: number
  horizonDays: number
  bufferMinutes: number
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
  locationType: AppointmentLocationType
  active: boolean
  public: boolean
  sort: number
}

export interface AppointmentTypeRow {
  id: string
  key: string
  slug: string
  label: string
  description: string
  duration_minutes: number
  location_type: AppointmentLocationType
  active: boolean
  public: boolean
  sort: number
}

export interface AppointmentRow {
  id: string
  appointment_type_id: string
  start_time: string
  end_time: string
  status: AppointmentStatus
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
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    label: row.label,
    description: row.description,
    durationMinutes: row.duration_minutes,
    locationType: row.location_type,
    active: row.active,
    public: row.public,
    sort: row.sort,
  }
}

export const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function emptyWeeklyHours(): WeeklyHours {
  return { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }
}
