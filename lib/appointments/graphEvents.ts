import 'server-only'
import { getAccessToken, getMicrosoftConnectionForUser } from '@/lib/microsoftCalendar'
import type { AppointmentType } from './types'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_TIMEOUT_MS = 15_000

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

export interface CreateEventInput {
  type: AppointmentType
  startIso: string
  endIso: string
  attendeeName: string
  attendeeEmail: string
  attendeePhone?: string | null
  secondAttendeeName?: string | null
  secondAttendeeEmail?: string | null
  notes?: string | null
  /** In-person location line (office address) when locationType = in_person. */
  officeAddress?: string | null
}

export interface CreatedEvent {
  eventId: string
  onlineMeetingUrl: string | null
}

function eventBodyHtml(input: CreateEventInput): string {
  const lines: string[] = [`<p>${input.type.label} with ${input.attendeeName}.</p>`]
  if (input.type.locationType === 'phone' && input.attendeePhone) {
    lines.push(`<p>Phone: ${input.attendeePhone}</p>`)
  }
  if (input.type.locationType === 'in_person' && input.officeAddress) {
    lines.push(`<p>Location: ${input.officeAddress}</p>`)
  }
  if (input.notes) {
    lines.push(`<p>Notes from client:</p><p>${input.notes}</p>`)
  }
  lines.push('<p>Booked through the Aubrey Law scheduling page.</p>')
  return lines.join('\n')
}

/**
 * Create the Outlook event. Attendee is included, so Outlook emails the
 * calendar invite (and cancellation on delete) automatically.
 */
export async function createCalendarEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)

  const isTeams = input.type.locationType === 'teams'
  const location =
    input.type.locationType === 'in_person' && input.officeAddress
      ? { displayName: input.officeAddress }
      : input.type.locationType === 'phone'
        ? { displayName: input.attendeePhone ? `Phone: ${input.attendeePhone}` : 'Phone call' }
        : undefined

  const payload: Record<string, unknown> = {
    subject: `${input.type.label} — ${input.attendeeName}`,
    body: { contentType: 'HTML', content: eventBodyHtml(input) },
    start: { dateTime: input.startIso, timeZone: 'UTC' },
    end: { dateTime: input.endIso, timeZone: 'UTC' },
    attendees: [
      {
        emailAddress: { address: input.attendeeEmail, name: input.attendeeName },
        type: 'required',
      },
      ...(input.secondAttendeeEmail
        ? [
            {
              emailAddress: {
                address: input.secondAttendeeEmail,
                name: input.secondAttendeeName || input.secondAttendeeEmail,
              },
              type: 'required',
            },
          ]
        : []),
    ],
  }
  if (location) payload.location = location
  if (isTeams) {
    payload.isOnlineMeeting = true
    payload.onlineMeetingProvider = 'teamsForBusiness'
  }

  const r = await graphFetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    const message =
      (json as { error?: { message?: string } }).error?.message || `Graph event create failed (${r.status})`
    throw new Error(message)
  }

  const created = json as { id?: string; onlineMeeting?: { joinUrl?: string } }
  if (!created.id) throw new Error('Graph event create returned no id')
  return {
    eventId: created.id,
    onlineMeetingUrl: created.onlineMeeting?.joinUrl ?? null,
  }
}

/** Delete the Outlook event — Outlook sends the cancellation to the attendee. */
export async function cancelCalendarEvent(eventId: string): Promise<void> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)

  const r = await graphFetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 = already gone; treat as success.
  if (!r.ok && r.status !== 404) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Graph event cancel failed (${r.status}): ${detail.slice(0, 300)}`)
  }
}

/** Move an existing Outlook event — Outlook emails the update to the attendee. */
export async function rescheduleCalendarEvent(
  eventId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)

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
}
