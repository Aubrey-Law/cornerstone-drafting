import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  getSchedulingSettings,
  listAppointmentTypes,
  updateAppointmentType,
  updateSchedulingSettings,
} from '@/lib/appointments/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const [settings, types] = await Promise.all([
    getSchedulingSettings(),
    listAppointmentTypes(),
  ])
  return NextResponse.json({ settings, types })
}

interface PutBody {
  settings?: {
    timezone?: unknown
    weeklyHours?: unknown
    minNoticeHours?: unknown
    horizonDays?: unknown
    bufferMinutes?: unknown
    reminderHoursBefore?: unknown
  }
  types?: Array<{
    id?: unknown
    label?: unknown
    description?: unknown
    durationMinutes?: unknown
    locationType?: unknown
    locationTypes?: unknown
    active?: unknown
    public?: unknown
    sort?: unknown
    customWeeklyHours?: unknown
  }>
}

function intInRange(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const n = Math.round(value)
  return n >= min && n <= max ? n : undefined
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export async function PUT(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as PutBody

  if (body.settings) {
    const s = body.settings
    const timezone =
      typeof s.timezone === 'string' && isValidTimezone(s.timezone.trim())
        ? s.timezone.trim()
        : undefined
    await updateSchedulingSettings({
      timezone,
      weeklyHours: s.weeklyHours,
      minNoticeHours: intInRange(s.minNoticeHours, 0, 720),
      horizonDays: intInRange(s.horizonDays, 1, 365),
      bufferMinutes: intInRange(s.bufferMinutes, 0, 240),
      reminderHoursBefore: intInRange(s.reminderHoursBefore, 0, 336),
      updatedBy: userId ?? null,
    })
  }

  if (Array.isArray(body.types)) {
    for (const t of body.types) {
      if (typeof t.id !== 'string') continue
      await updateAppointmentType({
        id: t.id,
        label: typeof t.label === 'string' ? t.label.trim().slice(0, 120) : undefined,
        description:
          typeof t.description === 'string' ? t.description.trim().slice(0, 500) : undefined,
        durationMinutes: intInRange(t.durationMinutes, 5, 480),
        locationType:
          t.locationType === 'phone' || t.locationType === 'teams' || t.locationType === 'in_person'
            ? t.locationType
            : undefined,
        // Sanitized in updateAppointmentType; an empty list leaves it unchanged.
        locationTypes: Array.isArray(t.locationTypes) ? t.locationTypes : undefined,
        active: typeof t.active === 'boolean' ? t.active : undefined,
        public: typeof t.public === 'boolean' ? t.public : undefined,
        sort: intInRange(t.sort, 0, 999),
        // Absent key = leave unchanged; null or an hours object = set/clear
        // (updateAppointmentType sanitizes, mapping empty/invalid to null).
        customWeeklyHours: 'customWeeklyHours' in t ? t.customWeeklyHours : undefined,
      })
    }
  }

  const [settings, types] = await Promise.all([
    getSchedulingSettings(),
    listAppointmentTypes(),
  ])
  return NextResponse.json({ ok: true, settings, types })
}
