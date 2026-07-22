import 'server-only'
import { getAccessToken, getMicrosoftConnectionForUser } from '@/lib/microsoftCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { Interval } from './types'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_TIMEOUT_MS = 15_000

export class AvailabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvailabilityUnavailableError'
  }
}

async function graphFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AvailabilityUnavailableError('Microsoft Graph request timed out')
    }
    throw err
  }
}

interface ScheduleItem {
  status?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
}

function parseGraphUtc(value: string | undefined): number | null {
  if (!value) return null
  // Graph returns dateTime without a zone suffix; we request UTC explicitly.
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? ts : null
}

/**
 * Busy intervals from the connected Outlook mailbox via getSchedule.
 * Fails closed: throws AvailabilityUnavailableError when Outlook is not
 * connected or Graph errors — callers must not offer unverifiable slots.
 */
export async function fetchOutlookBusy(rangeStart: Date, rangeEnd: Date): Promise<Interval[]> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn?.email) {
    throw new AvailabilityUnavailableError('Microsoft Outlook is not connected')
  }

  let token: string
  try {
    token = await getAccessToken(conn.user_id)
  } catch (err) {
    console.error('[appointments] Graph token acquisition failed:', err)
    throw new AvailabilityUnavailableError(
      err instanceof Error ? err.message : 'Failed to acquire Graph access token',
    )
  }

  const r = await graphFetch(`${GRAPH_BASE}/me/calendar/getSchedule`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="UTC"',
    },
    body: JSON.stringify({
      schedules: [conn.email],
      startTime: { dateTime: rangeStart.toISOString(), timeZone: 'UTC' },
      endTime: { dateTime: rangeEnd.toISOString(), timeZone: 'UTC' },
      availabilityViewInterval: 15,
    }),
  })

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    console.error('[appointments] getSchedule failed', r.status, detail.slice(0, 500))
    throw new AvailabilityUnavailableError('Could not read Outlook availability')
  }

  const json = (await r.json()) as {
    value?: Array<{ scheduleItems?: ScheduleItem[] }>
  }

  const items = json.value?.[0]?.scheduleItems ?? []
  const busy: Interval[] = []
  for (const item of items) {
    // 'free' events do not block; everything else (busy, tentative, oof) does.
    if (item.status === 'free') continue
    const start = parseGraphUtc(item.start?.dateTime)
    const end = parseGraphUtc(item.end?.dateTime)
    if (start === null || end === null || end <= start) continue
    busy.push({ start, end })
  }
  return busy
}

/**
 * Already-booked native appointments as busy intervals (covers the window
 * before a new Graph event shows up in getSchedule).
 */
export async function fetchAppointmentBusy(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Interval[]> {
  const { data, error } = await getAdminClient()
    .from('appointments')
    .select('start_time, end_time')
    .eq('status', 'scheduled')
    .lt('start_time', rangeEnd.toISOString())
    .gt('end_time', rangeStart.toISOString())

  if (error) {
    console.error('[appointments] busy lookup failed', error.message)
    throw new AvailabilityUnavailableError('Could not read existing appointments')
  }

  return ((data ?? []) as Array<{ start_time: string; end_time: string }>)
    .map(row => ({ start: Date.parse(row.start_time), end: Date.parse(row.end_time) }))
    .filter(iv => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
}

export async function fetchAllBusy(rangeStart: Date, rangeEnd: Date): Promise<Interval[]> {
  const [outlook, appointments] = await Promise.all([
    fetchOutlookBusy(rangeStart, rangeEnd),
    fetchAppointmentBusy(rangeStart, rangeEnd),
  ])
  return [...outlook, ...appointments]
}
