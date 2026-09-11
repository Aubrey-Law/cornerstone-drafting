import 'server-only'
import { getAccessToken, getGoogleConnectionForUser } from '@/lib/googleCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getRawBoolean } from '@/lib/appointments/rawMetadata'
import type { Interval } from './types'

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TIMEOUT_MS = 15_000

export class AvailabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvailabilityUnavailableError'
  }
}

async function googleFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AvailabilityUnavailableError('Google Calendar request timed out')
    }
    throw err
  }
}

/**
 * Busy intervals from the connected Google account via the freeBusy query.
 *
 * Fails closed: throws `AvailabilityUnavailableError` when Google is not
 * connected or the query errors. Offering a slot we could not verify is how a
 * client books on top of something already in the attorney's calendar, so a
 * read failure has to be louder than an empty result.
 */
export async function fetchCalendarBusy(rangeStart: Date, rangeEnd: Date): Promise<Interval[]> {
  const conn = await getGoogleConnectionForUser(null)
  if (!conn) {
    throw new AvailabilityUnavailableError('Google Calendar is not connected')
  }

  let token: string
  try {
    token = await getAccessToken(conn.user_id)
  } catch (err) {
    console.error('[appointments] Google token acquisition failed:', err)
    throw new AvailabilityUnavailableError(
      err instanceof Error ? err.message : 'Failed to acquire a Google access token',
    )
  }

  const r = await googleFetch(`${CALENDAR_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      // `primary` is the account's own calendar whatever its address is, so
      // this keeps working if the firm ever changes the Google address.
      items: [{ id: 'primary' }],
    }),
  })

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    console.error('[appointments] freeBusy failed', r.status, detail.slice(0, 500))
    throw new AvailabilityUnavailableError('Could not read Google Calendar availability')
  }

  const json = (await r.json()) as {
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }>; errors?: unknown[] }>
  }

  const calendar = json.calendars?.primary
  if (!calendar || (calendar.errors?.length ?? 0) > 0) {
    console.error('[appointments] freeBusy returned calendar errors', calendar?.errors)
    throw new AvailabilityUnavailableError('Could not read Google Calendar availability')
  }

  const busy: Interval[] = []
  for (const slot of calendar.busy ?? []) {
    const start = slot.start ? Date.parse(slot.start) : NaN
    const end = slot.end ? Date.parse(slot.end) : NaN
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    busy.push({ start, end })
  }
  return busy
}

/**
 * Already-booked native appointments as busy intervals (covers the window
 * before a new calendar event shows up in freeBusy).
 */
export async function fetchAppointmentBusy(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Interval[]> {
  const { data, error } = await getAdminClient()
    .from('appointments')
    .select('start_time, end_time, raw')
    .eq('status', 'scheduled')
    .lt('start_time', rangeEnd.toISOString())
    .gt('end_time', rangeStart.toISOString())

  if (error) {
    console.error('[appointments] busy lookup failed', error.message)
    throw new AvailabilityUnavailableError('Could not read existing appointments')
  }

  return ((data ?? []) as Array<{ start_time: string; end_time: string; raw?: unknown }>)
    .filter(row => getRawBoolean(row.raw, 'calendarShowAsBusy', true))
    .map(row => ({ start: Date.parse(row.start_time), end: Date.parse(row.end_time) }))
    .filter(iv => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
}

export async function fetchAllBusy(rangeStart: Date, rangeEnd: Date): Promise<Interval[]> {
  const [calendar, appointments] = await Promise.all([
    fetchCalendarBusy(rangeStart, rangeEnd),
    fetchAppointmentBusy(rangeStart, rangeEnd),
  ])
  return [...calendar, ...appointments]
}
