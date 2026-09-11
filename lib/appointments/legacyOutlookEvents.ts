import 'server-only'
import { revalidateTag } from 'next/cache'
import { getAccessToken, getMicrosoftConnectionForUser } from '@/lib/microsoftCalendar'
import type { CalendarAttendee } from './calendarTypes'

/**
 * The legacy Outlook path — cancel, move, and read the attendees of events
 * that were created back when the firm ran on Microsoft 365.
 *
 * Nothing new is written here. The firm's calendar is Google
 * (`googleEvents.ts`), but appointments booked before the switchover still
 * carry a `microsoft_event_id`, and cancelling one has to happen in the
 * calendar that actually holds it. Routing those to Google instead would leave
 * the real event in place — which surfaces a week later as a client arriving
 * for a meeting the attorney believes they cancelled.
 *
 * This module retires itself: once no appointment row carries a
 * `microsoft_event_id` for a future date, it and `lib/microsoftCalendar.ts`
 * can both be deleted.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_TIMEOUT_MS = 15_000

function invalidateTodayCalendar() {
  try { revalidateTag('today-calendar-snapshot', { expire: 0 }) }
  catch { console.warn('Calendar display cache invalidation unavailable; snapshot expires within five minutes') }
}

async function graphFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Microsoft Graph request timed out')
    }
    throw err
  }
}

async function connectedToken(): Promise<string> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  return getAccessToken(conn.user_id)
}

/** RSVP state for one legacy Outlook event. Failure degrades at the caller. */
export async function getCalendarEventAttendees(eventId: string): Promise<CalendarAttendee[]> {
  const token = await connectedToken()
  const params = new URLSearchParams({ '$select': 'attendees' })
  const r = await graphFetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await r.json().catch(() => ({})) as {
    attendees?: Array<{
      emailAddress?: { name?: string; address?: string }
      status?: { response?: string }
    }>
    error?: { message?: string }
  }
  if (!r.ok) throw new Error(json.error?.message || `Graph event lookup failed (${r.status})`)
  return (json.attendees ?? []).flatMap(attendee => {
    const email = attendee.emailAddress?.address?.trim()
    if (!email) return []
    return [{
      name: attendee.emailAddress?.name?.trim() || email,
      email,
      status: attendee.status?.response ?? 'none',
    }]
  })
}

/** Delete the Outlook event — Outlook sends the cancellation to the attendee. */
export async function cancelCalendarEvent(eventId: string): Promise<void> {
  const token = await connectedToken()

  const r = await graphFetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 = already gone; treat as success.
  if (!r.ok && r.status !== 404) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Graph event cancel failed (${r.status}): ${detail.slice(0, 300)}`)
  }
  invalidateTodayCalendar()
}

/** Move an existing Outlook event — Outlook emails the update to the attendee. */
export async function rescheduleCalendarEvent(
  eventId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const token = await connectedToken()

  const r = await graphFetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      start: { dateTime: startIso, timeZone: 'UTC' },
      end: { dateTime: endIso, timeZone: 'UTC' },
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Graph event reschedule failed (${r.status}): ${detail.slice(0, 300)}`)
  }
  invalidateTodayCalendar()
}
