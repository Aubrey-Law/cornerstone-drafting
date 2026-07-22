import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  appointmentTypeFromRow,
  emptyWeeklyHours,
  WEEKDAYS,
  type AppointmentType,
  type AppointmentTypeRow,
  type DayWindow,
  type SchedulingSettings,
  type WeeklyHours,
} from './types'

interface SchedulingSettingsRow {
  timezone: string | null
  weekly_hours: unknown
  min_notice_hours: number | null
  horizon_days: number | null
  buffer_minutes: number | null
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
  }
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

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value

  const { data } = await getAdminClient()
    .from('scheduling_settings')
    .select('timezone, weekly_hours, min_notice_hours, horizon_days, buffer_minutes')
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
    .select('id, key, slug, label, description, duration_minutes, location_type, active, public, sort')
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
  active?: boolean
  public?: boolean
  sort?: number
}

export async function updateAppointmentType(input: UpdateAppointmentTypeInput): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.label !== undefined) patch.label = input.label
  if (input.description !== undefined) patch.description = input.description
  if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes
  if (input.locationType !== undefined) patch.location_type = input.locationType
  if (input.active !== undefined) patch.active = input.active
  if (input.public !== undefined) patch.public = input.public
  if (input.sort !== undefined) patch.sort = input.sort
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
