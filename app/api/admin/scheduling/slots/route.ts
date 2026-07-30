import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { computeSlots } from '@/lib/appointments/availability'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/graphBusy'
import { getSchedulingSettings, listAppointmentTypes } from '@/lib/appointments/settings'
import { effectiveWeeklyHours, isAppointmentLocationType } from '@/lib/appointments/types'
import { annotateSlots } from '@/lib/calendarProductivity'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_RANGE_MS = 10 * 86_400_000
const CLIENT_MEETING_CAP = 3

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const params = req.nextUrl.searchParams
  const type = (await listAppointmentTypes()).find(item => item.id === params.get('typeId'))
  const from = new Date(params.get('from') ?? '')
  const to = new Date(params.get('to') ?? '')
  const locationType = params.get('locationType')
  if (!type || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return NextResponse.json({ error: 'Valid typeId, from, and to are required' }, { status: 400 })
  }
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return NextResponse.json({ error: 'Invalid slot range' }, { status: 400 })
  }
  if (!isAppointmentLocationType(locationType) || !type.locationTypes.includes(locationType)) {
    return NextResponse.json({ error: 'That meeting format is unavailable for this type' }, { status: 400 })
  }

  const settings = await getSchedulingSettings()
  try {
    const busy = await fetchAllBusy(from, to)
    const weeklyHours = effectiveWeeklyHours(settings.weeklyHours, type)
    const slots = computeSlots({
      weeklyHours,
      timezone: settings.timezone,
      durationMinutes: type.durationMinutes,
      bufferMinutes: settings.bufferMinutes,
      // Staff can book same-day, but slots still respect hours, duration and buffers.
      minNoticeHours: 0,
      horizonDays: 10,
      busy,
      now: new Date(),
      rangeStart: from,
      rangeEnd: to,
      dateOverrides: settings.dateOverrides,
    })
    const preferred = params.get('preferred')
    if (preferred && Number.isFinite(Date.parse(preferred))) {
      const preferredStart = Date.parse(preferred)
      const preferredEnd = preferredStart + type.durationMinutes * 60_000
      const buffer = settings.bufferMinutes * 60_000
      const fitsRange = preferredStart >= from.getTime() && preferredEnd <= to.getTime()
      const free = !busy.some(interval =>
        preferredStart < interval.end + buffer && preferredEnd > interval.start - buffer,
      )
      if (fitsRange && free) slots.push(new Date(preferredStart).toISOString())
    }
    const uniqueSlots = [...new Set(slots)].sort()
    const { data } = await getAdminClient()
      .from('appointments')
      .select('start_time')
      .eq('status', 'scheduled')
      .gte('start_time', from.toISOString())
      .lt('start_time', to.toISOString())
    const annotated = annotateSlots({
      slots: uniqueSlots,
      durationMinutes: type.durationMinutes,
      timezone: settings.timezone,
      weeklyHours,
      existingClientStarts: (data ?? []).map(row => row.start_time),
      clientMeetingCap: CLIENT_MEETING_CAP,
    })
    return NextResponse.json({
      connected: true,
      slots: annotated,
      clientMeetingCap: CLIENT_MEETING_CAP,
    })
  } catch (error) {
    if (error instanceof AvailabilityUnavailableError) {
      return NextResponse.json({ connected: false, slots: [], error: error.message })
    }
    throw error
  }
}
