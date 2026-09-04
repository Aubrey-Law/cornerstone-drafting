import { getAccessToken, getGoogleConnectionForUser } from '@/lib/googleCalendar'
import type { CreateEventInput, CreatedEvent } from '@/lib/appointments/graphEvents'

/**
 * Google Calendar writes for appointments.
 *
 * The contract matches `graphEvents.ts` exactly — same input, same
 * `{eventId, onlineMeetingUrl}` out — so `calendarSync` can pick between them
 * without either side leaking into the booking flow.
 */

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TIMEOUT_MS = 15_000

/**
 * Google emails the attendee only when asked.
 *
 * Outlook sends the invite, the update and the cancellation on its own. Google
 * sends none of them unless `sendUpdates=all` rides on the request, and it
 * reports success either way — so omitting it produces a calendar that looks
 * correct to the attorney while the client is never told anything. Every write
 * below carries it.
 */
const SEND_UPDATES = 'sendUpdates=all'

async function googleFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error('Google Calendar request timed out')
    }
    throw err
  }
}

async function connectedToken(): Promise<string> {
  const conn = await getGoogleConnectionForUser(null)
  if (!conn) throw new Error('Google Calendar is not connected')
  return getAccessToken(conn.user_id)
}

async function failure(r: Response, what: string): Promise<Error> {
  const detail = await r.text().catch(() => '')
  return new Error(`Google Calendar ${what} failed (${r.status}): ${detail.slice(0, 300)}`)
}

/**
 * The event description.
 *
 * Plain text with newlines, not the HTML the Graph path builds: Google renders
 * only a narrow subset of HTML in a description and shows the rest as literal
 * tags, so `<p>` markup arrives as visible angle brackets in the client's invite.
 */
function eventDescription(input: CreateEventInput): string {
  const lines: string[] = [`${input.type.label} with ${input.attendeeName}.`]
  if (input.type.locationType === 'phone' && input.attendeePhone) {
    lines.push(`Phone: ${input.attendeePhone}`)
  }
  if (input.type.locationType === 'in_person' && input.officeAddress) {
    lines.push(`Location: ${input.officeAddress}`)
  }
  if (input.notes) {
    lines.push('', 'Notes from client:', input.notes)
  }
  lines.push('', 'Booked through the Aubrey Law scheduling page.')
  return lines.join('\n')
}

function locationLine(input: CreateEventInput): string | undefined {
  if (input.type.locationType === 'in_person' && input.officeAddress) return input.officeAddress
  if (input.type.locationType === 'phone') {
    return input.attendeePhone ? `Phone: ${input.attendeePhone}` : 'Phone call'
  }
  return undefined
}

export async function createCalendarEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const token = await connectedToken()

  // `teams` is the stored name for "this meeting happens online". On Google that
  // is a Meet link; the appointment type is not re-pointed at a second vendor
  // just to say so.
  const wantsVideo = input.type.locationType === 'teams'

  const payload: Record<string, unknown> = {
    summary: `${input.type.label} — ${input.attendeeName}`,
    description: eventDescription(input),
    start: { dateTime: input.startIso, timeZone: 'UTC' },
    end: { dateTime: input.endIso, timeZone: 'UTC' },
    attendees: [
      { email: input.attendeeEmail, displayName: input.attendeeName },
      ...(input.secondAttendeeEmail
        ? [{
            email: input.secondAttendeeEmail,
            displayName: input.secondAttendeeName || input.secondAttendeeEmail,
          }]
        : []),
    ],
  }

  const location = locationLine(input)
  if (location) payload.location = location

  if (wantsVideo) {
    payload.conferenceData = {
      createRequest: {
        // Google requires a caller-supplied id it can use to make the create
        // idempotent; a fresh one per attempt is what the API expects.
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }

  // conferenceDataVersion=1 is required for Google to honour conferenceData at
  // all. Without it the event is created successfully with no Meet link, which
  // reads as a video appointment nobody can join.
  const query = `${SEND_UPDATES}${wantsVideo ? '&conferenceDataVersion=1' : ''}`
  const r = await googleFetch(`${CALENDAR_BASE}/calendars/primary/events?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!r.ok) throw await failure(r, 'event create')

  const created = (await r.json().catch(() => ({}))) as {
    id?: string
    hangoutLink?: string
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  }
  if (!created.id) throw new Error('Google Calendar event create returned no id')

  const videoEntry = created.conferenceData?.entryPoints?.find(
    entry => entry.entryPointType === 'video',
  )
  return {
    eventId: created.id,
    onlineMeetingUrl: created.hangoutLink ?? videoEntry?.uri ?? null,
  }
}

export async function cancelCalendarEvent(eventId: string): Promise<void> {
  const token = await connectedToken()

  const r = await googleFetch(
    `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?${SEND_UPDATES}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  // 404 is never-existed, 410 is already-deleted. Both mean the event is gone,
  // which is the state a cancel is asking for.
  if (!r.ok && r.status !== 404 && r.status !== 410) throw await failure(r, 'event cancel')
}

export async function rescheduleCalendarEvent(
  eventId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const token = await connectedToken()

  const r = await googleFetch(
    `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?${SEND_UPDATES}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { dateTime: startIso, timeZone: 'UTC' },
        end: { dateTime: endIso, timeZone: 'UTC' },
      }),
    },
  )
  if (!r.ok) throw await failure(r, 'event reschedule')
}
