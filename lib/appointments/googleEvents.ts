import 'server-only'
import { createHash } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { getAccessToken, getGoogleConnectionForUser } from '@/lib/googleCalendar'
import { formatBookingAnswers } from './bookingQuestions'
import { visibleCalendars } from './calendarSelection'
import { getSchedulingSettings } from './settings'
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventTimes,
  CalendarRef,
  CalendarViewResult,
  CreateEventInput,
  CreatedEvent,
} from '@/lib/appointments/calendarTypes'

/**
 * Google Calendar, which is where the firm's appointments and holds live.
 *
 * Everything here speaks the provider-neutral shapes in `calendarTypes.ts`, so
 * the booking flow, the admin calendar and the availability check never learn
 * whose calendar they are talking to.
 */

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TIMEOUT_MS = 15_000

function invalidateTodayCalendar() {
  try { revalidateTag('today-calendar-snapshot', { expire: 0 }) }
  catch { console.warn('Calendar display cache invalidation unavailable; snapshot expires within five minutes') }
}

/**
 * Google emails the attendee only when asked.
 *
 * It sends no invite, update or cancellation unless `sendUpdates=all` rides on
 * the request, and it reports success either way — so omitting it produces a
 * calendar that looks correct to the attorney while the client is never told
 * anything. Every write below carries it.
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

async function connectedToken(ownerId?: string | null): Promise<string> {
  const conn = await getGoogleConnectionForUser(ownerId ?? null)
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
  if (input.teamsJoinUrl) {
    lines.push('', teamsDescriptionBlock(input.teamsJoinUrl))
  }
  if (input.bookingAnswers && input.bookingAnswers.length > 0) {
    lines.push('', formatBookingAnswers(input.bookingAnswers))
  }
  if (input.notes) {
    lines.push('', 'Notes from client:', input.notes)
  }
  lines.push('', 'Booked through the Aubrey Law scheduling page.')
  return lines.join('\n')
}

const TEAMS_BLOCK_HEADING = 'Microsoft Teams meeting'

function teamsDescriptionBlock(joinUrl: string): string {
  return `${TEAMS_BLOCK_HEADING}\nJoin: ${joinUrl}`
}

function locationLine(input: CreateEventInput): string | undefined {
  if (input.teamsJoinUrl) return input.teamsJoinUrl
  if (input.type.locationType === 'in_person' && input.officeAddress) return input.officeAddress
  if (input.type.locationType === 'phone') {
    return input.attendeePhone ? `Phone: ${input.attendeePhone}` : 'Phone call'
  }
  return undefined
}

export async function createCalendarEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const token = await connectedToken()

  // `teams` is the stored token for "this meeting happens online", kept from
  // the Microsoft 365 era. It means a Meet link here, unless a real Teams
  // meeting was created for the booking, whose link then stands in for Meet.
  // The value is opaque to clients, who only see the "Virtual meeting" label.
  const wantsVideo = input.type.locationType === 'teams' && !input.teamsJoinUrl

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

  invalidateTodayCalendar()
  if (input.teamsJoinUrl) return { eventId: created.id, onlineMeetingUrl: input.teamsJoinUrl }
  const videoEntry = created.conferenceData?.entryPoints?.find(
    entry => entry.entryPointType === 'video',
  )
  return {
    eventId: created.id,
    onlineMeetingUrl: created.hangoutLink ?? videoEntry?.uri ?? null,
  }
}

/**
 * Put a Teams join link on an existing event, replacing any Google Meet.
 *
 * The Meet is removed rather than left alongside: an invite carrying two
 * different "join" links leaves the client guessing which one the attorney
 * will be in. `sendUpdates=all` emails attendees the updated invite.
 */
export async function attachTeamsMeetingToCalendarEvent(
  eventId: string,
  joinUrl: string,
): Promise<void> {
  const token = await connectedToken()
  const url = `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`

  const current = await googleFetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!current.ok) throw await failure(current, 'event lookup')
  const event = (await current.json().catch(() => ({}))) as { description?: string }

  // An earlier Teams block is dropped so re-adding never stacks two links.
  const kept = (event.description ?? '')
    .split(/\n{2,}/)
    .filter(block => !block.startsWith(TEAMS_BLOCK_HEADING))
    .join('\n\n')
    .trim()
  const description = [teamsDescriptionBlock(joinUrl), kept].filter(Boolean).join('\n\n')

  const r = await googleFetch(`${url}?${SEND_UPDATES}&conferenceDataVersion=1`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: joinUrl, description, conferenceData: null }),
  })
  if (!r.ok) throw await failure(r, 'event update')
  invalidateTodayCalendar()
}

/**
 * Put a Google Meet on an existing event, replacing any Teams link.
 *
 * The mirror of attachTeamsMeetingToCalendarEvent: the Teams block and the
 * Teams location are removed so the invite carries one join link, and Google
 * creates the Meet (conferenceDataVersion=1). `sendUpdates=all` emails the
 * attendees the updated invite. Returns the new Meet link.
 */
export async function attachGoogleMeetToCalendarEvent(eventId: string): Promise<string> {
  const token = await connectedToken()
  const url = `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`

  const current = await googleFetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!current.ok) throw await failure(current, 'event lookup')
  const event = (await current.json().catch(() => ({}))) as { description?: string; location?: string }

  const description = (event.description ?? '')
    .split(/\n{2,}/)
    .filter(block => !block.startsWith(TEAMS_BLOCK_HEADING))
    .join('\n\n')
    .trim()
  // The Teams join URL was the location; anything else (an office address) stays.
  const location = event.location && /teams\.microsoft\.com/i.test(event.location) ? '' : event.location

  const r = await googleFetch(`${url}?${SEND_UPDATES}&conferenceDataVersion=1`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      ...(location !== undefined ? { location } : {}),
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    }),
  })
  if (!r.ok) throw await failure(r, 'event update')
  invalidateTodayCalendar()

  const updated = (await r.json().catch(() => ({}))) as {
    hangoutLink?: string
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  }
  const link =
    updated.hangoutLink ??
    updated.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri
  if (!link) throw new Error('Google Calendar did not return a Meet link')
  return link
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
  invalidateTodayCalendar()
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
  invalidateTodayCalendar()
}

/**
 * Create an attorney-only planning hold. No attendees means no client email.
 *
 * `transparency` is what Google calls free/busy: 'transparent' is a hold that
 * still leaves the time bookable, which is exactly what `showAsBusy: false`
 * asks for.
 */
export async function createCalendarHold(input: {
  title: string
  startIso: string
  endIso: string
  matterId?: string | null
  showAsBusy?: boolean
  idempotencyKey?: string
}): Promise<CreatedEvent> {
  const token = await connectedToken()
  // Google accepts caller-selected event ids using base32hex characters. A
  // stable digest turns retries after a database or network failure into the
  // same event rather than a second calendar block.
  const eventId = input.idempotencyKey
    ? createHash('sha256').update(`cornerstone-calendar-hold:${input.idempotencyKey}`).digest('hex')
    : undefined
  const r = await googleFetch(`${CALENDAR_BASE}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(eventId ? { id: eventId } : {}),
      summary: `BLOCK · ${input.title}`,
      description: input.matterId
        ? `Cornerstone matter: ${input.matterId}`
        : 'Cornerstone planning hold',
      start: { dateTime: input.startIso, timeZone: 'UTC' },
      end: { dateTime: input.endIso, timeZone: 'UTC' },
      transparency: input.showAsBusy === false ? 'transparent' : 'opaque',
    }),
  })
  if (r.status === 409 && eventId) {
    invalidateTodayCalendar()
    return { eventId, onlineMeetingUrl: null }
  }
  if (!r.ok) throw await failure(r, 'hold create')
  const json = (await r.json().catch(() => ({}))) as { id?: string }
  if (!json.id) throw new Error('Google Calendar hold create returned no id')
  invalidateTodayCalendar()
  return { eventId: json.id, onlineMeetingUrl: null }
}

/** RSVP state for one event. Failure is allowed to degrade at the caller. */
export async function getCalendarEventAttendees(eventId: string): Promise<CalendarAttendee[]> {
  const token = await connectedToken()
  const r = await googleFetch(
    `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) throw await failure(r, 'event lookup')
  const json = (await r.json().catch(() => ({}))) as {
    attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>
  }
  return (json.attendees ?? []).flatMap(attendee => {
    const email = attendee.email?.trim()
    if (!email) return []
    return [{
      name: attendee.displayName?.trim() || email,
      email,
      status: attendee.responseStatus ?? 'needsAction',
    }]
  })
}

interface RawGoogleEvent {
  id?: string
  status?: string
  summary?: string
  transparency?: string
  recurringEventId?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  /** Injected by listCalendarView — Google does not return these on an event. */
  calendarId?: string
  calendarName?: string
}

/**
 * Google returns either a timed `dateTime` (with an offset) or an all-day
 * `date`. An all-day `date` is a calendar day in the calendar's own zone, and
 * anchoring it at UTC midnight is what the admin grid already expects from the
 * all-day lane.
 */
function googleTimeToIso(slot: { dateTime?: string; date?: string } | undefined): string | null {
  const raw = slot?.dateTime ?? (slot?.date ? `${slot.date}T00:00:00Z` : undefined)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function isAllDay(item: RawGoogleEvent): boolean {
  return Boolean(item.start?.date && !item.start?.dateTime)
}

/**
 * Map raw Google events to the admin calendar's overlay, dropping cancelled
 * events and any event that IS a Cornerstone appointment (those render from
 * the appointments table — excluding them here prevents duplicates). Duplicate
 * ids are collapsed: an event visible on two of the account's calendars is
 * still one event.
 */
export function mapCalendarView(
  raw: unknown,
  excludeEventIds: ReadonlySet<string>,
): CalendarEvent[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, CalendarEvent>()
  for (const item of raw as RawGoogleEvent[]) {
    if (!item || typeof item !== 'object' || !item.id) continue
    if (item.status === 'cancelled') continue
    if (excludeEventIds.has(item.id)) continue
    if (item.recurringEventId && excludeEventIds.has(item.recurringEventId)) continue
    if (byId.has(item.id)) continue
    const startIso = googleTimeToIso(item.start)
    const endIso = googleTimeToIso(item.end)
    if (!startIso || !endIso) continue
    byId.set(item.id, {
      id: item.id,
      subject: item.summary?.trim() || '(no subject)',
      startIso,
      endIso,
      isAllDay: isAllDay(item),
      showAs: item.transparency === 'transparent' ? 'free' : 'busy',
      calendarId: item.calendarId ?? null,
      calendarName: item.calendarName?.trim() || null,
    })
  }
  return [...byId.values()].sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/**
 * Index raw Google events by id for reconciliation.
 *
 * Unlike `mapCalendarView` this keeps cancelled events and Cornerstone's own
 * bookings — those are exactly the rows the appointments table needs to be told
 * about. Recurring instances are indexed under their series id too, so a
 * booking the attorney turned into a repeating event still resolves.
 */
export function mapEventTimes(raw: unknown): Map<string, CalendarEventTimes> {
  const byId = new Map<string, CalendarEventTimes>()
  if (!Array.isArray(raw)) return byId
  for (const item of raw as RawGoogleEvent[]) {
    if (!item || typeof item !== 'object' || !item.id) continue
    const startIso = googleTimeToIso(item.start)
    const endIso = googleTimeToIso(item.end)
    if (!startIso || !endIso) continue
    const times: CalendarEventTimes = {
      id: item.id,
      startIso,
      endIso,
      isCancelled: item.status === 'cancelled',
    }
    byId.set(item.id, times)
    // A series resolves to its earliest occurrence in range, which is the
    // instance a Cornerstone booking turned into a series would match.
    if (item.recurringEventId) {
      const current = byId.get(item.recurringEventId)
      if (!current || startIso < current.startIso) {
        byId.set(item.recurringEventId, { ...times, id: item.recurringEventId })
      }
    }
  }
  return byId
}

const EVENTS_MAX_PAGES = 5
const SECONDARY_CALENDAR_MAX_PAGES = 2
const EVENTS_PAGE_SIZE = 250
const MAX_SECONDARY_CALENDARS = 15
// Google meters per-user requests, and starting every extra calendar at once
// spends that budget on enrichment while the primary-calendar and booking reads
// queue behind it. Two at a time leaves capacity for the reads that matter.
const SECONDARY_CALENDAR_CONCURRENCY = 2

/**
 * Wall-clock budget for reading the extra calendars. The primary calendar is
 * fetched first and is never subject to this — the budget only decides how
 * many *additional* calendars we still have time for before the serverless
 * function's own limit would cut us off.
 */
const SECONDARY_CALENDAR_BUDGET_MS = 6_000

/** Every calendar on the connected account, primary first. */
export async function listAccountCalendars(): Promise<CalendarRef[]> {
  return fetchAccountCalendars(await connectedToken())
}

async function fetchAccountCalendars(token: string): Promise<CalendarRef[]> {
  const params = new URLSearchParams({ maxResults: '100', minAccessRole: 'reader' })
  const r = await googleFetch(`${CALENDAR_BASE}/users/me/calendarList?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw await failure(r, 'calendar list')
  const json = (await r.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; summary?: string; summaryOverride?: string; primary?: boolean }>
  }
  const calendars = (json.items ?? []).flatMap(item => {
    if (!item?.id) return []
    return [{
      id: item.id,
      name: (item.summaryOverride ?? item.summary)?.trim() || 'Calendar',
      isDefault: Boolean(item.primary),
    }]
  })
  // Primary first so its events win any id collision.
  return calendars.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/**
 * Follow pageToken pages for one calendar's events.list.
 *
 * `deadline` is the shared budget for the extra calendars. It is checked
 * between pages *and* passed to the request itself: a calendar that starts
 * just under the budget would otherwise run its whole page allowance past it,
 * and a request that stalls would hold the budget open indefinitely.
 */
async function fetchEventPages(
  token: string,
  calendarId: string,
  fromIso: string,
  toIso: string,
  maxPages: number,
  deadline?: number,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = []
  let pageToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const remaining = deadline === undefined ? GOOGLE_TIMEOUT_MS : deadline - Date.now()
    if (remaining <= 0) throw new Error('calendar read budget exhausted')
    const params = new URLSearchParams({
      timeMin: fromIso,
      timeMax: toIso,
      // Recurring events are expanded into the occurrences that actually fall
      // in range; the unexpanded master would render as one event at the
      // series start and nothing on the days it recurs.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(EVENTS_PAGE_SIZE),
      // Deletions are what tell reconciliation an appointment was cancelled in
      // Google, so they have to come back rather than being filtered server-side.
      showDeleted: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const r = await googleFetch(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.min(GOOGLE_TIMEOUT_MS, remaining)),
      },
    )
    if (!r.ok) throw await failure(r, 'events list')
    const json = (await r.json().catch(() => ({}))) as {
      items?: unknown[]
      nextPageToken?: string
    }
    items.push(...(json.items ?? []))
    pageToken = json.nextPageToken
    if (!pageToken) return { items, truncated: false }
  }
  return { items, truncated: Boolean(pageToken) }
}

/** Tag each raw Google item with the calendar it was read from. */
function tagWithCalendar(items: unknown[], id: string | null, name: string | null): unknown[] {
  if (!id && !name) return items
  return items.map(item =>
    item && typeof item === 'object'
      ? { ...(item as Record<string, unknown>), calendarId: id, calendarName: name }
      : item,
  )
}

/**
 * The attorney's Google events for a range, across the account's calendars
 * (raw events, each tagged with its calendar id and name).
 *
 * The **primary calendar is authoritative**: it is read first, on its own, and
 * a failure there is a real "cannot read the calendar" and throws. Every other
 * calendar is best-effort enrichment — a subscribed holiday or birthday
 * calendar that Google refuses to serve is recorded in `skipped` and never
 * takes the view down with it. Reading the extras is also time-boxed, so a slow
 * account cannot push the request past the serverless function's own limit.
 */
export async function listCalendarView(
  fromIso: string,
  toIso: string,
  ownerId?: string,
): Promise<CalendarViewResult> {
  const token = await connectedToken(ownerId)

  // 1. The primary calendar. Required — this is what "connected" means.
  const primary = await fetchEventPages(token, 'primary', fromIso, toIso, EVENTS_MAX_PAGES)

  // 2. The rest of the account, best effort. Never fatal from here down.
  let account: CalendarRef[] = []
  try {
    account = await fetchAccountCalendars(token)
  } catch (err) {
    console.error('[appointments] could not list Google calendars', err)
  }

  const primaryCalendar = account.find(calendar => calendar.isDefault) ?? null
  const raw = tagWithCalendar(
    primary.items,
    primaryCalendar?.id ?? null,
    primaryCalendar?.name ?? null,
  )
  if (account.length === 0) {
    return { raw, calendars: [], truncated: primary.truncated, skipped: [] }
  }

  // Hidden calendars are never fetched. Deselecting is therefore how the
  // attorney spends the secondary budget deliberately: MAX_SECONDARY_CALENDARS
  // and SECONDARY_CALENDAR_BUDGET_MS apply to whatever survives this filter, so
  // hiding noise is what keeps a calendar they care about out of `skipped`.
  const { hiddenCalendarIds } = await getSchedulingSettings()
  const others = visibleCalendars(account, hiddenCalendarIds).filter(
    calendar => !calendar.isDefault,
  )
  const secondary = others.slice(0, MAX_SECONDARY_CALENDARS)
  const skipped = others.slice(MAX_SECONDARY_CALENDARS).map(calendar => calendar.name)
  const deadline = Date.now() + SECONDARY_CALENDAR_BUDGET_MS

  // A fixed pool rather than one promise per calendar, so the concurrency
  // ceiling above actually holds. Results are written back by index, which is
  // what keeps `calendars` and `skipped` in the account's own order.
  const settled: Array<PromiseSettledResult<{
    calendar: CalendarRef; truncated: boolean; items: unknown[]
  }>> = new Array(secondary.length)
  let next = 0
  await Promise.all(
    Array.from(
      { length: Math.min(SECONDARY_CALENDAR_CONCURRENCY, secondary.length) },
      async () => {
        while (next < secondary.length) {
          const index = next++
          const calendar = secondary[index]
          try {
            const { items, truncated } = await fetchEventPages(
              token,
              calendar.id,
              fromIso,
              toIso,
              SECONDARY_CALENDAR_MAX_PAGES,
              deadline,
            )
            settled[index] = {
              status: 'fulfilled',
              value: {
                calendar,
                truncated,
                items: tagWithCalendar(items, calendar.id, calendar.name),
              },
            }
          } catch (reason) {
            settled[index] = { status: 'rejected', reason }
          }
        }
      },
    ),
  )

  const readCalendars: CalendarRef[] = primaryCalendar ? [primaryCalendar] : []
  let truncated = primary.truncated
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const name = secondary[index]?.name ?? 'Unknown calendar'
      console.error(`[appointments] skipping Google calendar "${name}"`, result.reason)
      skipped.push(name)
      return
    }
    raw.push(...result.value.items)
    readCalendars.push(result.value.calendar)
    truncated = truncated || result.value.truncated
  })

  return { raw, calendars: readCalendars, truncated, skipped }
}

/**
 * Look one event up directly. Returns null when Google no longer has it (404)
 * — that is how a delete made in Google Calendar is detected, as opposed to an
 * event that merely moved out of the range being viewed.
 */
export async function getCalendarEventTimes(
  eventId: string,
): Promise<CalendarEventTimes | null> {
  const token = await connectedToken()
  const r = await googleFetch(
    `${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (r.status === 404 || r.status === 410) return null
  if (!r.ok) throw await failure(r, 'event lookup')
  const json = (await r.json().catch(() => ({}))) as RawGoogleEvent
  const startIso = googleTimeToIso(json.start)
  const endIso = googleTimeToIso(json.end)
  if (!startIso || !endIso) return null
  return { id: eventId, startIso, endIso, isCancelled: json.status === 'cancelled' }
}
