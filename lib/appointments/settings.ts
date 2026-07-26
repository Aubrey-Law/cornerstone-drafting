import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sanitizeCalendlyUrls } from '@/lib/calendly/links'
import {
  appointmentTypeFromRow,
  emptyWeeklyHours,
  isAppointmentLocationType,
  sanitizeCustomWeeklyHours,
  sanitizeDateOverrides,
  sanitizeWeeklyHours,
  type AppointmentType,
  type AppointmentTypeRow,
  type SchedulingSettings,
} from './types'

export { sanitizeWeeklyHours }

interface SchedulingSettingsRow {
  timezone: string | null
  weekly_hours: unknown
  min_notice_hours: number | null
  horizon_days: number | null
  buffer_minutes: number | null
  reminder_hours_before: number | null
  booking_paused: boolean | null
  sms_reminders_enabled: boolean | null
  auto_intake_invite: boolean | null
  date_overrides: unknown
  calendly_urls: unknown
}

const TTL_MS = 30_000
let settingsCache: { value: SchedulingSettings; at: number } | null = null
let typesCache: { value: AppointmentType[]; at: number } | null = null

function defaults(): SchedulingSettings {
  const hours = emptyWeeklyHours()
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) {
    hours[day] = [{ start: '09:00', end: '17:00' }]
  }
  return {
    timezone: 'America/New_York',
    weeklyHours: hours,
    minNoticeHours: 24,
    horizonDays: 30,
    bufferMinutes: 15,
    reminderHoursBefore: 24,
    bookingPaused: false,
    smsRemindersEnabled: false,
    autoIntakeInvite: true,
    dateOverrides: {},
    calendlyUrls: {},
  }
}

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value

  const { data } = await getAdminClient()
    .from('scheduling_settings')
    .select('timezone, weekly_hours, min_notice_hours, horizon_days, buffer_minutes, reminder_hours_before, booking_paused, sms_reminders_enabled, auto_intake_invite, date_overrides, calendly_urls')
    .eq('id', 1)
    .maybeSingle()

  const base = defaults()
  const row = data as SchedulingSettingsRow | null
  const value: SchedulingSettings = row
    ? {
        timezone: row.timezone?.trim() || base.timezone,
        weeklyHours: sanitizeWeeklyHours(row.weekly_hours),
        minNoticeHours: row.min_notice_hours ?? base.minNoticeHours,
        horizonDays: row.horizon_days ?? base.horizonDays,
        bufferMinutes: row.buffer_minutes ?? base.bufferMinutes,
        reminderHoursBefore: row.reminder_hours_before ?? base.reminderHoursBefore,
        bookingPaused: row.booking_paused ?? base.bookingPaused,
        smsRemindersEnabled: row.sms_reminders_enabled ?? base.smsRemindersEnabled,
        autoIntakeInvite: row.auto_intake_invite ?? base.autoIntakeInvite,
        dateOverrides: sanitizeDateOverrides(row.date_overrides),
        calendlyUrls: sanitizeCalendlyUrls(row.calendly_urls),
      }
    : base

  settingsCache = { value, at: Date.now() }
  return value
}

export interface UpdateSchedulingSettingsInput {
  timezone?: string
  weeklyHours?: unknown
  minNoticeHours?: number
  horizonDays?: number
  bufferMinutes?: number
  reminderHoursBefore?: number
  bookingPaused?: boolean
  smsRemindersEnabled?: boolean
  autoIntakeInvite?: boolean
  dateOverrides?: unknown
  calendlyUrls?: unknown
  updatedBy?: string | null
}

export async function updateSchedulingSettings(
  input: UpdateSchedulingSettingsInput,
): Promise<void> {
  const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
  if (input.timezone !== undefined) patch.timezone = input.timezone
  if (input.weeklyHours !== undefined) patch.weekly_hours = sanitizeWeeklyHours(input.weeklyHours)
  if (input.minNoticeHours !== undefined) patch.min_notice_hours = input.minNoticeHours
  if (input.horizonDays !== undefined) patch.horizon_days = input.horizonDays
  if (input.bufferMinutes !== undefined) patch.buffer_minutes = input.bufferMinutes
  if (input.reminderHoursBefore !== undefined) patch.reminder_hours_before = input.reminderHoursBefore
  if (input.bookingPaused !== undefined) patch.booking_paused = input.bookingPaused
  if (input.smsRemindersEnabled !== undefined) patch.sms_reminders_enabled = input.smsRemindersEnabled
  if (input.autoIntakeInvite !== undefined) patch.auto_intake_invite = input.autoIntakeInvite
  if (input.dateOverrides !== undefined) patch.date_overrides = sanitizeDateOverrides(input.dateOverrides)
  if (input.calendlyUrls !== undefined) patch.calendly_urls = sanitizeCalendlyUrls(input.calendlyUrls)
  if (input.updatedBy !== undefined) patch.updated_by = input.updatedBy

  const { error } = await getAdminClient()
    .from('scheduling_settings')
    .upsert(patch, { onConflict: 'id' })
  if (error) throw error
  settingsCache = null
}

export async function listAppointmentTypes(): Promise<AppointmentType[]> {
  if (typesCache && Date.now() - typesCache.at < TTL_MS) return typesCache.value

  const { data } = await getAdminClient()
    .from('appointment_types')
    .select('id, key, slug, label, description, duration_minutes, location_type, location_types, active, public, sort, custom_weekly_hours')
    .order('sort', { ascending: true })

  const value = ((data ?? []) as AppointmentTypeRow[]).map(appointmentTypeFromRow)
  typesCache = { value, at: Date.now() }
  return value
}

export async function getAppointmentTypeBySlug(slug: string): Promise<AppointmentType | null> {
  const types = await listAppointmentTypes()
  return types.find(t => t.slug === slug.trim()) ?? null
}

export async function getAppointmentTypeByKey(key: string): Promise<AppointmentType | null> {
  const types = await listAppointmentTypes()
  return types.find(t => t.key === key.trim()) ?? null
}

export interface UpdateAppointmentTypeInput {
  id: string
  label?: string
  description?: string
  durationMinutes?: number
  locationType?: string
  /** Ordered allowed formats; first entry becomes the default location_type. */
  locationTypes?: unknown
  active?: boolean
  public?: boolean
  sort?: number
  /** null clears the override (use general hours); an object limits the type to those windows. */
  customWeeklyHours?: unknown
}

export async function updateAppointmentType(input: UpdateAppointmentTypeInput): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.label !== undefined) patch.label = input.label
  if (input.description !== undefined) patch.description = input.description
  if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes
  if (input.locationType !== undefined) patch.location_type = input.locationType
  if (input.locationTypes !== undefined) {
    const list = Array.isArray(input.locationTypes)
      ? [...new Set(input.locationTypes.filter(isAppointmentLocationType))]
      : []
    if (list.length > 0) {
      patch.location_types = list
      // Keep the legacy single-format column synced to the default.
      patch.location_type = list[0]
    }
  }
  if (input.active !== undefined) patch.active = input.active
  if (input.public !== undefined) patch.public = input.public
  if (input.sort !== undefined) patch.sort = input.sort
  if (input.customWeeklyHours !== undefined) {
    patch.custom_weekly_hours = sanitizeCustomWeeklyHours(input.customWeeklyHours)
  }
  if (Object.keys(patch).length === 0) return

  const { error } = await getAdminClient()
    .from('appointment_types')
    .update(patch)
    .eq('id', input.id)
  if (error) throw error
  typesCache = null
}

/** Test-only: reset module caches. */
export function __resetSchedulingCaches(): void {
  settingsCache = null
  typesCache = null
}
