import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { calendarAnchorDate } from '@/lib/calendarDay'
import { AvailabilityUnavailableError, fetchAllBusy } from '@/lib/appointments/calendarBusy'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import { dateInstant, nextDateKey, workingDayWindows } from '@/lib/calendarAvailability'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const date = req.nextUrl.searchParams.get('date')
  if (!date || !Number.isFinite(calendarAnchorDate(date, new Date(NaN)).getTime())) return NextResponse.json({ error: 'Valid date required' }, { status: 400 })
  try {
    const settings = await getSchedulingSettings()
    const start = dateInstant(date, settings.timezone)
    const end = dateInstant(nextDateKey(date), settings.timezone)
    const busy = await fetchAllBusy(new Date(start), new Date(end))
    return NextResponse.json({ date, connected: true, timezone: settings.timezone, windows: workingDayWindows(date, settings.timezone, settings.weeklyHours, settings.dateOverrides), busy, bufferMinutes: settings.bufferMinutes })
  } catch (error) {
    if (!(error instanceof AvailabilityUnavailableError)) console.error('[calendar availability]', error)
    return NextResponse.json({ date, connected: false, windows: [], busy: [], error: 'Availability unavailable' })
  }
}
