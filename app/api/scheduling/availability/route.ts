import { NextResponse } from 'next/server'
import { computeSlots } from '@/lib/appointments/availability'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/graphBusy'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { hashManageToken, isManageTokenExpired } from '@/lib/appointments/manageTokens'
import { getAppointmentTypeBySlug, getSchedulingSettings } from '@/lib/appointments/settings'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getCachedClaims } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_RANGE_DAYS = 31
const DAY_MS = 86_400_000

/** A valid manage token for a booking of this type authorizes reschedule browsing. */
async function manageTokenAuthorizes(
  token: string | null,
  appointmentTypeId: string,
): Promise<boolean> {
  if (!token || token.length > 200) return false
  const { data } = await getAdminClient()
    .from('appointments')
    .select('appointment_type_id, manage_token_expires_at')
    .eq('manage_token_hash', hashManageToken(token))
    .maybeSingle()
  if (!data) return false
  const row = data as { appointment_type_id: string; manage_token_expires_at: string | null }
  return row.appointment_type_id === appointmentTypeId && !isManageTokenExpired(row.manage_token_expires_at)
}

/**
 * Free slots for an appointment type in a date range. Returns only slot start
 * times — never busy-event details. Fails closed when Outlook is unreachable.
 */
export async function GET(req: Request) {
  const limited = await guardPublicSchedulingRoute(req, 'scheduling_availability', 60)
  if (limited) return limited

  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('type')?.trim()
  if (!slug) return NextResponse.json({ error: 'type is required' }, { status: 400 })

  const type = await getAppointmentTypeBySlug(slug)
  if (!type || !type.active) {
    return NextResponse.json({ error: 'Unknown appointment type' }, { status: 404 })
  }
  if (!type.public) {
    const claims = await getCachedClaims()
    const authorized = claims
      ? true
      : await manageTokenAuthorizes(searchParams.get('manageToken'), type.id)
    if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const from = fromParam ? Date.parse(fromParam) : Date.now()
  const to = toParam ? Date.parse(toParam) : from + 7 * DAY_MS
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }
  if (to - from > MAX_RANGE_DAYS * DAY_MS) {
    return NextResponse.json({ error: 'Date range too large' }, { status: 400 })
  }

  const settings = await getSchedulingSettings()

  try {
    const busy = await fetchAllBusy(new Date(from), new Date(to))
    const slots = computeSlots({
      weeklyHours: settings.weeklyHours,
      timezone: settings.timezone,
      durationMinutes: type.durationMinutes,
      bufferMinutes: settings.bufferMinutes,
      minNoticeHours: settings.minNoticeHours,
      horizonDays: settings.horizonDays,
      busy,
      now: new Date(),
      rangeStart: new Date(from),
      rangeEnd: new Date(to),
    })
    return NextResponse.json({
      slots,
      timezone: settings.timezone,
      durationMinutes: type.durationMinutes,
      horizonDays: settings.horizonDays,
    })
  } catch (err) {
    if (err instanceof AvailabilityUnavailableError) {
      // Fail closed — never offer slots we can't verify against Outlook.
      return NextResponse.json(
        { error: 'Scheduling is temporarily unavailable. Please try again later.' },
        { status: 503 },
      )
    }
    throw err
  }
}
