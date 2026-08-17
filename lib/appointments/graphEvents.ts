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

/** Create an attorney-only planning hold. No attendees means no client email. */
export async function createCalendarHold(input: {
  title: string
  startIso: string
  endIso: string
  matterId?: string | null
  showAsBusy?: boolean
}): Promise<CreatedEvent> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)
  const r = await graphFetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `BLOCK · ${input.title}`,
      body: {
        contentType: 'Text',
        content: input.matterId ? `Cornerstone matter: ${input.matterId}` : 'Cornerstone planning hold',
      },
      start: { dateTime: input.startIso, timeZone: 'UTC' },
      end: { dateTime: input.endIso, timeZone: 'UTC' },
      showAs: input.showAsBusy === false ? 'free' : 'busy',
      categories: ['Cornerstone'],
    }),
  })
  const json = await r.json().catch(() => ({})) as { id?: string; error?: { message?: string } }
  if (!r.ok || !json.id) throw new Error(json.error?.message || `Graph hold create failed (${r.status})`)
  return { eventId: json.id, onlineMeetingUrl: null }
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

export interface OutlookCalendarEvent {
  id: string
  subject: string
  startIso: string
  endIso: string
  isAllDay: boolean
  /** Outlook free/busy status: free | tentative | busy | oof | workingElsewhere. */
  showAs: string
  /** Graph id of the mailbox calendar the event lives on. */
  calendarId?: string | null
  /** Display name of that calendar ("Calendar", "Court dates", a shared one…). */
  calendarName?: string | null
}

export interface OutlookAttendee {
  name: string
  email: string
  status: string
}

/** RSVP state for one Outlook event. Failure is allowed to degrade at the caller. */
export async function getCalendarEventAttendees(eventId: string): Promise<OutlookAttendee[]> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)
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

interface RawGraphViewEvent {
  id?: string
  seriesMasterId?: string
  subject?: string
  isAllDay?: boolean
  isCancelled?: boolean
  showAs?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  /** Injected by listCalendarView — Graph does not return these on calendarView. */
  calendarId?: string
  calendarName?: string
}

/** Graph returns naive datetimes in the requested zone (we request UTC). */
function graphDateTimeToIso(value: string | undefined): string | null {
  if (!value) return null
  const iso = /z$|[+-]\d\d:\d\d$/i.test(value) ? value : `${value}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Map Graph calendarView items (across every mailbox calendar) to calendar
 * events, dropping cancelled events and any event that IS a Cornerstone
 * appointment (those render from the appointments table — excluding them here
 * prevents duplicates). Duplicate ids are collapsed: an event that lives on
 * two calendars the mailbox can see is still one event.
 */
export function mapGraphCalendarView(
  raw: unknown,
  excludeEventIds: ReadonlySet<string>,
): OutlookCalendarEvent[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, OutlookCalendarEvent>()
  for (const item of raw as RawGraphViewEvent[]) {
    if (!item || typeof item !== 'object' || !item.id) continue
    if (item.isCancelled) continue
    if (excludeEventIds.has(item.id)) continue
    if (item.seriesMasterId && excludeEventIds.has(item.seriesMasterId)) continue
    if (byId.has(item.id)) continue
    const startIso = graphDateTimeToIso(item.start?.dateTime)
    const endIso = graphDateTimeToIso(item.end?.dateTime)
    if (!startIso || !endIso) continue
    byId.set(item.id, {
      id: item.id,
      subject: item.subject?.trim() || '(no subject)',
      startIso,
      endIso,
      isAllDay: Boolean(item.isAllDay),
      showAs: item.showAs ?? 'busy',
      calendarId: item.calendarId ?? null,
      calendarName: item.calendarName?.trim() || null,
    })
  }
  return [...byId.values()].sort((a, b) => a.startIso.localeCompare(b.startIso))
}

export interface OutlookEventTimes {
  id: string
  startIso: string
  endIso: string
  isCancelled: boolean
}

/**
 * Index raw Graph calendarView items by event id for reconciliation.
 *
 * Unlike `mapGraphCalendarView` this keeps cancelled events and Cornerstone's
 * own bookings — those are exactly the rows the appointments table needs to be
 * told about. Recurring instances are indexed under their series master id too,
 * so a Cornerstone booking that Outlook turned into a series still resolves.
 */
export function mapGraphEventTimes(raw: unknown): Map<string, OutlookEventTimes> {
  const byId = new Map<string, OutlookEventTimes>()
  if (!Array.isArray(raw)) return byId
  for (const item of raw as RawGraphViewEvent[]) {
    if (!item || typeof item !== 'object' || !item.id) continue
    const startIso = graphDateTimeToIso(item.start?.dateTime)
    const endIso = graphDateTimeToIso(item.end?.dateTime)
    if (!startIso || !endIso) continue
    const times: OutlookEventTimes = {
      id: item.id,
      startIso,
      endIso,
      isCancelled: Boolean(item.isCancelled),
    }
    byId.set(item.id, times)
    // A series master resolves to its earliest occurrence in range, which is
    // the instance a Cornerstone booking turned into a series would match.
    if (item.seriesMasterId) {
      const current = byId.get(item.seriesMasterId)
      if (!current || startIso < current.startIso) {
        byId.set(item.seriesMasterId, { ...times, id: item.seriesMasterId })
      }
    }
  }
  return byId
}

const CALENDAR_VIEW_MAX_PAGES = 5
const SECONDARY_CALENDAR_MAX_PAGES = 2
const CALENDAR_VIEW_PAGE_SIZE = 200
const MAX_SECONDARY_CALENDARS = 15
const CALENDAR_VIEW_SELECT = 'id,seriesMasterId,subject,isAllDay,isCancelled,showAs,start,end'

/**
 * Wall-clock budget for reading the extra calendars. The default calendar is
 * fetched first and is never subject to this — the budget only decides how
 * many *additional* calendars we still have time for before the serverless
 * function's own limit would cut us off.
 */
const SECONDARY_CALENDAR_BUDGET_MS = 6_000

/** One calendar in the connected mailbox. */
export interface OutlookCalendarRef {
  id: string
  name: string
  isDefault: boolean
}

export interface CalendarViewResult {
  /** Raw Graph events, each tagged with the calendar it came from. */
  raw: unknown[]
  /** Calendars actually read, default calendar first. */
  calendars: OutlookCalendarRef[]
  /** True when a calendar had more pages than we read — events were left out. */
  truncated: boolean
  /** Names of calendars Graph would not serve, or that we ran out of time for. */
  skipped: string[]
}

/**
 * Every calendar in the connected mailbox, default first. Includes secondary
 * and added/shared calendars, which `/me/calendarView` alone never returns.
 */
export async function listMailboxCalendars(): Promise<OutlookCalendarRef[]> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)
  return fetchMailboxCalendars(token)
}

async function fetchMailboxCalendars(token: string): Promise<OutlookCalendarRef[]> {
  const params = new URLSearchParams({
    $select: 'id,name,isDefaultCalendar',
    $top: '50',
  })
  const r = await graphFetch(`${GRAPH_BASE}/me/calendars?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = (await r.json().catch(() => ({}))) as {
    value?: Array<{ id?: string; name?: string; isDefaultCalendar?: boolean }>
    error?: { message?: string }
  }
  if (!r.ok) throw new Error(json.error?.message || `Graph calendars failed (${r.status})`)
  const calendars = (json.value ?? []).flatMap(item => {
    if (!item?.id) return []
    return [{
      id: item.id,
      name: item.name?.trim() || 'Calendar',
      isDefault: Boolean(item.isDefaultCalendar),
    }]
  })
  // Default first so the primary calendar's events win any id collision.
  return calendars.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** Follow nextLink pages for one calendarView URL. */
async function fetchCalendarViewPages(
  token: string,
  firstUrl: string,
  maxPages: number,
): Promise<{ items: unknown[]; truncated: boolean }> {
  let url: string | null = firstUrl
  const items: unknown[] = []
  for (let page = 0; url && page < maxPages; page++) {
    const r = await graphFetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    })
    const json = (await r.json().catch(() => ({}))) as {
      value?: unknown[]
      '@odata.nextLink'?: string
      error?: { message?: string }
    }
    if (!r.ok) {
      throw new Error(json.error?.message || `Graph calendarView failed (${r.status})`)
    }
    items.push(...(json.value ?? []))
    url = json['@odata.nextLink'] ?? null
  }
  return { items, truncated: Boolean(url) }
}

function calendarViewUrl(calendarId: string | null, fromIso: string, toIso: string): string {
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $top: String(CALENDAR_VIEW_PAGE_SIZE),
    $orderby: 'start/dateTime',
    $select: CALENDAR_VIEW_SELECT,
  })
  const base = calendarId
    ? `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
    : `${GRAPH_BASE}/me/calendarView`
  return `${base}?${params.toString()}`
}

/** Tag each raw Graph item with the calendar it was read from. */
function tagWithCalendar(items: unknown[], id: string | null, name: string | null): unknown[] {
  if (!id && !name) return items
  return items.map(item =>
    item && typeof item === 'object'
      ? { ...(item as Record<string, unknown>), calendarId: id, calendarName: name }
      : item,
  )
}

/**
 * The attorney's Outlook events for a range, across the mailbox's calendars
 * (raw Graph events, UTC), each tagged with its calendar id and name.
 *
 * The **default calendar is authoritative**: it is read first, on its own, via
 * `/me/calendarView`, and a failure there is a real "cannot read Outlook" and
 * throws. Every other calendar is best-effort enrichment — one that Graph
 * refuses to serve (the Birthdays calendar and subscribed holiday calendars
 * commonly error) is recorded in `skipped` and never takes the view down with
 * it. Reading the extras is also time-boxed, so a slow mailbox cannot push the
 * request past the serverless function's own limit.
 */
export async function listCalendarView(
  fromIso: string,
  toIso: string,
): Promise<CalendarViewResult> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)

  // 1. The default calendar. Required — this is what "connected" means.
  const primary = await fetchCalendarViewPages(
    token,
    calendarViewUrl(null, fromIso, toIso),
    CALENDAR_VIEW_MAX_PAGES,
  )

  // 2. The rest of the mailbox, best effort. Never fatal from here down.
  let mailbox: OutlookCalendarRef[] = []
  try {
    mailbox = await fetchMailboxCalendars(token)
  } catch (err) {
    console.error('[appointments] could not list mailbox calendars', err)
  }

  const defaultCalendar = mailbox.find(calendar => calendar.isDefault) ?? null
  const raw = tagWithCalendar(
    primary.items,
    defaultCalendar?.id ?? null,
    defaultCalendar?.name ?? null,
  )
  if (mailbox.length === 0) {
    return {
      raw,
      calendars: [],
      truncated: primary.truncated,
      skipped: [],
    }
  }

  const secondary = mailbox
    .filter(calendar => !calendar.isDefault)
    .slice(0, MAX_SECONDARY_CALENDARS)
  const skipped = mailbox
    .filter(calendar => !calendar.isDefault)
    .slice(MAX_SECONDARY_CALENDARS)
    .map(calendar => calendar.name)
  const deadline = Date.now() + SECONDARY_CALENDAR_BUDGET_MS

  const settled = await Promise.allSettled(
    secondary.map(async calendar => {
      if (Date.now() > deadline) throw new Error('calendar read budget exhausted')
      const { items, truncated } = await fetchCalendarViewPages(
        token,
        calendarViewUrl(calendar.id, fromIso, toIso),
        SECONDARY_CALENDAR_MAX_PAGES,
      )
      return { calendar, truncated, items: tagWithCalendar(items, calendar.id, calendar.name) }
    }),
  )

  const readCalendars: OutlookCalendarRef[] = defaultCalendar ? [defaultCalendar] : []
  let truncated = primary.truncated
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const name = secondary[index]?.name ?? 'Unknown calendar'
      console.error(`[appointments] skipping Outlook calendar "${name}"`, result.reason)
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
 * Look one Outlook event up directly. Returns null when Outlook no longer has
 * it (404) — that is how a delete made in Outlook is detected, as opposed to
 * an event that merely moved out of the range being viewed.
 */
export async function getCalendarEventTimes(eventId: string): Promise<OutlookEventTimes | null> {
  const conn = await getMicrosoftConnectionForUser(null)
  if (!conn) throw new Error('Microsoft Outlook is not connected')
  const token = await getAccessToken(conn.user_id)
  const params = new URLSearchParams({ $select: 'id,isCancelled,start,end' })
  const r = await graphFetch(
    `${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } },
  )
  if (r.status === 404) return null
  const json = (await r.json().catch(() => ({}))) as RawGraphViewEvent & {
    error?: { message?: string }
  }
  if (!r.ok) throw new Error(json.error?.message || `Graph event lookup failed (${r.status})`)
  const startIso = graphDateTimeToIso(json.start?.dateTime)
  const endIso = graphDateTimeToIso(json.end?.dateTime)
  if (!startIso || !endIso) return null
  return { id: eventId, startIso, endIso, isCancelled: Boolean(json.isCancelled) }
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
