import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { processBookingEvent, type BookingAction } from '@/lib/bookings/sync'
import { IntegrationError } from '@/lib/integrations/errors'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'
import { lawmaticsRequest } from './client'

/**
 * Lawmatics → calendar import.
 *
 * Lawmatics' outbound webhooks carry no appointment events, so bookings made in
 * Lawmatics (booking forms, staff scheduling) are pulled from its API instead:
 * on a schedule (app/api/cron/lawmatics-calendar) and immediately when a
 * booking form's `form.submitted` webhook arrives (app/api/webhooks/lawmatics).
 * Each new, moved, or cancelled event goes through the shared booking sync, so
 * it lands in external_bookings, on the lead/matter, and on the calendar as a
 * read-only `source = 'lawmatics'` appointment.
 *
 * Events Cornerstone itself pushed to Lawmatics (lib/integrations/lawmatics/
 * appointments.ts) are skipped, so the two directions never duplicate a meeting.
 */

const PER_PAGE = 100
const MAX_PAGES = 20
const MAX_MISSING_CHECKS = 50
const LOOKBACK_MS = 24 * 60 * 60 * 1000
const HORIZON_MS = 180 * 24 * 60 * 60 * 1000
/** Written into every event Cornerstone creates in Lawmatics (appointments.ts). */
const OUTBOUND_MARKER = 'Cornerstone appointment reference:'

type AdminClient = ReturnType<typeof getAdminClient>

export function isLawmaticsCalendarImportEnabled(): boolean {
  return process.env.LAWMATICS_CALENDAR_SYNC_ENABLED?.trim().toLowerCase() === 'true'
}

export interface LawmaticsEventRef {
  type: 'prospect' | 'contact'
  id: string
}

export interface ParsedLawmaticsEvent {
  id: string
  name: string
  description: string
  start: string
  end: string
  allDay: boolean
  cancelled: boolean
  eventTypeId: string | null
  eventable: LawmaticsEventRef | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isoTime(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function relationshipRef(relationships: Record<string, unknown>, name: string): { type: string | null; id: string | null } {
  const data = record(record(relationships[name]).data)
  return { type: text(data.type), id: text(data.id) }
}

function eventableRef(type: string | null, id: string | null): LawmaticsEventRef | null {
  const normalized = type?.toLowerCase()
  if (!id || (normalized !== 'prospect' && normalized !== 'contact')) return null
  return { type: normalized, id }
}

/**
 * Parse a Lawmatics JSON:API event resource. Field names are read defensively
 * (attributes first, then relationships) since the list and show endpoints
 * are not guaranteed to shape relations the same way.
 */
export function parseLawmaticsEvent(resource: unknown): ParsedLawmaticsEvent | null {
  const res = record(resource)
  const id = text(res.id)
  if (!id) return null
  const attributes = record(res.attributes)
  const relationships = record(res.relationships)

  const start = isoTime(attributes.start_date ?? attributes.starts_at ?? attributes.start_time)
  const end = isoTime(attributes.end_date ?? attributes.ends_at ?? attributes.end_time)
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return null

  const status = text(attributes.status)?.toLowerCase()
  const cancelled = attributes.canceled === true || attributes.cancelled === true
    || status === 'canceled' || status === 'cancelled'
    || Boolean(text(attributes.canceled_at) ?? text(attributes.cancelled_at) ?? text(attributes.deleted_at))

  const relEventable = relationshipRef(relationships, 'eventable')
  const eventable = eventableRef(text(attributes.eventable_type), text(attributes.eventable_id))
    ?? eventableRef(relEventable.type, relEventable.id)

  return {
    id,
    name: text(attributes.name) ?? text(attributes.title) ?? '',
    description: text(attributes.description) ?? '',
    start,
    end,
    allDay: attributes.all_day === true,
    cancelled,
    eventTypeId: text(attributes.event_type_id) ?? relationshipRef(relationships, 'event_type').id,
    eventable,
  }
}

export interface LawmaticsCalendarSyncResult {
  skipped?: 'disabled' | 'not_connected'
  scanned: number
  mirrored: number
  cancelled: number
  ignored: number
  failed: number
}

interface Person {
  name: string
  email: string | null
  phone: string | null
}

interface StoredBooking {
  booking_uid: string
  status: string
  start_time: string | null
  end_time: string | null
  event_key: string | null
  event_label: string | null
  attendee_email: string | null
  attendee_name: string | null
  linked_lead_id: string | null
  updated_at: string | null
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  return Date.parse(a) === Date.parse(b)
}

async function fetchEventsPage(page: number): Promise<unknown[]> {
  const data = await lawmaticsRequest<unknown>(
    `/v1/events?page=${page}&per_page=${PER_PAGE}&fields=all`,
    { method: 'GET' },
  )
  return Array.isArray(data) ? data : []
}

async function fetchEvent(id: string): Promise<ParsedLawmaticsEvent | 'missing' | null> {
  try {
    const data = await lawmaticsRequest<unknown>(`/v1/events/${encodeURIComponent(id)}?fields=all`, { method: 'GET' })
    return parseLawmaticsEvent(data)
  } catch (error) {
    if (error instanceof IntegrationError && error.code === 'not_found') return 'missing'
    throw error
  }
}

async function fetchPerson(ref: LawmaticsEventRef): Promise<Person | null> {
  const path = ref.type === 'prospect' ? 'prospects' : 'contacts'
  try {
    const data = record(await lawmaticsRequest<unknown>(`/v1/${path}/${encodeURIComponent(ref.id)}`, { method: 'GET' }))
    const attributes = record(data.attributes)
    const name = [text(attributes.first_name), text(attributes.last_name)].filter(Boolean).join(' ')
    return {
      name: name || text(attributes.name) || '',
      email: text(attributes.email)?.toLowerCase() ?? null,
      phone: text(attributes.phone),
    }
  } catch (error) {
    if (error instanceof IntegrationError && error.code === 'not_found') return null
    throw error
  }
}

/** Lawmatics prospect id → Cornerstone lead (client_intake) id, via the push/import links. */
async function leadIdForProspect(admin: AdminClient, prospectId: string): Promise<string | null> {
  const { data: linked, error } = await admin.from('integration_external_records')
    .select('internal_entity_id')
    .eq('provider', 'lawmatics').eq('internal_entity_type', 'lead')
    .eq('external_record_type', 'prospect').eq('external_id', prospectId)
    .limit(1)
  if (error) throw error
  const fromRecord = (linked as Array<{ internal_entity_id: string }> | null)?.[0]?.internal_entity_id
  if (fromRecord) return fromRecord

  const { data: legacy, error: legacyError } = await admin.from('client_intake')
    .select('id').eq('lawmatics_matter_id', prospectId).limit(1)
  if (legacyError) throw legacyError
  return (legacy as Array<{ id: string }> | null)?.[0]?.id ?? null
}

async function outboundEventIds(admin: AdminClient): Promise<Set<string>> {
  const { data, error } = await admin.from('integration_external_records')
    .select('external_id')
    .eq('provider', 'lawmatics').eq('external_record_type', 'event')
    .not('external_id', 'is', null)
  if (error) throw error
  return new Set(((data ?? []) as Array<{ external_id: string | null }>).map(row => row.external_id).filter((id): id is string => Boolean(id)))
}

async function storedBookings(admin: AdminClient, ids: string[]): Promise<Map<string, StoredBooking>> {
  const map = new Map<string, StoredBooking>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from('external_bookings')
      .select('booking_uid, status, start_time, end_time, event_key, event_label, attendee_email, attendee_name, linked_lead_id, updated_at')
      .eq('provider', 'lawmatics').in('booking_uid', ids.slice(i, i + 100))
    if (error) throw error
    for (const row of (data ?? []) as StoredBooking[]) map.set(row.booking_uid, row)
  }
  return map
}

function actionFor(event: ParsedLawmaticsEvent, stored: StoredBooking | undefined): BookingAction | null {
  if (!stored) return event.cancelled ? null : 'created'
  const storedCancelled = stored.status === 'cancelled' || stored.status === 'superseded'
  if (event.cancelled) return storedCancelled ? null : 'cancelled'
  if (!storedCancelled && sameInstant(stored.start_time, event.start) && sameInstant(stored.end_time, event.end)) return null
  return storedCancelled ? 'created' : 'rescheduled'
}

const STATUS_FOR_ACTION: Record<BookingAction, 'scheduled' | 'rescheduled' | 'cancelled' | 'superseded'> = {
  created: 'scheduled',
  rescheduled: 'rescheduled',
  cancelled: 'cancelled',
  superseded: 'superseded',
}

/**
 * Claim one observed event state in the shared webhook ledger, then record it.
 * The claim makes overlapping runs (cron + form webhook) process a change once.
 * The key includes the stored booking's updated_at, which every processed
 * change advances, so a later move back to an earlier time is still recorded.
 */
async function recordChange(admin: AdminClient, input: {
  action: BookingAction
  storedVersion: string | null
  eventId: string
  start: string
  end: string
  eventKey: MeetingTypeKey | null
  eventTypeId: string | null
  eventLabel: string
  person: Person
  leadId: string | null
}): Promise<boolean> {
  const claimKey = `event:${input.eventId}:${input.storedVersion ?? 'new'}:${input.action}:${input.start}:${input.end}`
  const { data: claimed, error: claimError } = await admin.rpc('claim_webhook_event', {
    p_provider: 'lawmatics',
    p_event_id: claimKey,
    p_event_type: `lawmatics.event.${input.action}`,
    p_payload: { eventId: input.eventId, eventTypeId: input.eventTypeId },
    p_occurred_at: input.start,
  })
  if (claimError) throw claimError
  if (claimed === false) return false

  try {
    await processBookingEvent({
      provider: 'lawmatics',
      providerLabel: 'Lawmatics',
      leadSource: 'lawmatics',
      action: input.action,
      triggerEvent: `lawmatics.event.${input.action}`,
      bookingUid: input.eventId,
      bookingId: null,
      attendeeEmail: input.person.email ?? '',
      attendeeName: input.person.name,
      attendeePhone: input.person.phone,
      eventKey: input.eventKey,
      eventSlug: input.eventTypeId ?? '',
      eventLabel: input.eventLabel,
      startTime: input.start,
      endTime: input.end,
      metadataLeadId: input.leadId,
      metadataMatterId: null,
      // Identifiers only; the contact's details live on the lead and appointment.
      rawBody: { eventId: input.eventId, eventTypeId: input.eventTypeId, start: input.start, end: input.end },
      status: STATUS_FOR_ACTION[input.action],
    })
  } catch (error) {
    const { error: releaseError } = await admin.rpc('release_webhook_event', { p_provider: 'lawmatics', p_event_id: claimKey })
    if (releaseError) console.error('[lawmatics-calendar] claim release failed', { eventId: input.eventId })
    throw error
  }
  return true
}

export async function syncLawmaticsCalendar(options: { now?: Date } = {}): Promise<LawmaticsCalendarSyncResult> {
  const result: LawmaticsCalendarSyncResult = { scanned: 0, mirrored: 0, cancelled: 0, ignored: 0, failed: 0 }
  if (!isLawmaticsCalendarImportEnabled()) return { ...result, skipped: 'disabled' }

  const admin = getAdminClient()
  const nowMs = (options.now ?? new Date()).getTime()
  const settings = await getIntegrationSettings()
  const keyForEventType = new Map<string, MeetingTypeKey>()
  for (const [key, eventTypeId] of Object.entries(settings.lawmaticsEventTypeIdMap)) {
    const meetingType = meetingTypeForKey(key)
    if (meetingType) keyForEventType.set(eventTypeId, meetingType.key)
  }
  const outbound = await outboundEventIds(admin)
  const people = new Map<string, Person | null>()
  const leads = new Map<string, string | null>()

  const inWindow = (event: ParsedLawmaticsEvent) =>
    Date.parse(event.end) >= nowMs - LOOKBACK_MS && Date.parse(event.start) <= nowMs + HORIZON_MS
  const importable = (event: ParsedLawmaticsEvent) =>
    !event.allDay && event.eventable !== null && !outbound.has(event.id) && !event.description.includes(OUTBOUND_MARKER)

  // 1. Pull events. Pages are read until a short page; nothing about the
  //    API's default ordering is assumed, so the window is applied locally.
  const events: ParsedLawmaticsEvent[] = []
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await fetchEventsPage(page)
      for (const row of rows) {
        const event = parseLawmaticsEvent(row)
        if (!event) continue
        result.scanned++
        if (inWindow(event) && importable(event)) events.push(event)
        else result.ignored++
      }
      if (rows.length < PER_PAGE) break
      if (page === MAX_PAGES) console.warn('[lawmatics-calendar] event scan hit the page cap', { pages: MAX_PAGES })
    }
  } catch (error) {
    if (error instanceof IntegrationError && error.code === 'authentication_required') {
      return { ...result, skipped: 'not_connected' }
    }
    throw error
  }

  const seen = new Set(events.map(event => event.id))
  const stored = await storedBookings(admin, [...seen])

  const personFor = async (ref: LawmaticsEventRef): Promise<Person | null> => {
    const key = `${ref.type}:${ref.id}`
    if (!people.has(key)) people.set(key, await fetchPerson(ref))
    return people.get(key) ?? null
  }
  const leadFor = async (ref: LawmaticsEventRef): Promise<string | null> => {
    if (ref.type !== 'prospect') return null
    if (!leads.has(ref.id)) leads.set(ref.id, await leadIdForProspect(admin, ref.id))
    return leads.get(ref.id) ?? null
  }

  // 2. Record new, moved, and cancelled events.
  for (const event of events) {
    const previous = stored.get(event.id)
    const action = actionFor(event, previous)
    if (!action) continue
    try {
      const person = await personFor(event.eventable!)
      if (!person?.email) {
        // The calendar row needs an attendee email; skip until the contact has one.
        result.ignored++
        continue
      }
      const eventKey = event.eventTypeId ? keyForEventType.get(event.eventTypeId) ?? null : null
      const processed = await recordChange(admin, {
        action,
        storedVersion: previous?.updated_at ?? null,
        eventId: event.id,
        start: event.start,
        end: event.end,
        eventKey,
        eventTypeId: event.eventTypeId,
        eventLabel: (eventKey ? meetingTypeForKey(eventKey)?.label : null) ?? event.name,
        person,
        leadId: await leadFor(event.eventable!),
      })
      if (processed) {
        if (action === 'cancelled') result.cancelled++
        else result.mirrored++
      }
    } catch (error) {
      result.failed++
      console.error('[lawmatics-calendar] event sync failed', { eventId: event.id, error })
    }
  }

  // 3. Lawmatics deletes cancelled events outright, so an upcoming mirrored
  //    booking that no longer appears in the scan is checked directly.
  const { data: upcoming, error: upcomingError } = await admin.from('external_bookings')
    .select('booking_uid, status, start_time, end_time, event_key, event_label, attendee_email, attendee_name, linked_lead_id, updated_at')
    .eq('provider', 'lawmatics').in('status', ['scheduled', 'rescheduled'])
    .gte('end_time', new Date(nowMs - LOOKBACK_MS).toISOString())
    .order('start_time', { ascending: true })
    .limit(MAX_MISSING_CHECKS * 2)
  if (upcomingError) throw upcomingError
  const unseen = ((upcoming ?? []) as StoredBooking[]).filter(row => !seen.has(row.booking_uid)).slice(0, MAX_MISSING_CHECKS)
  for (const row of unseen) {
    try {
      const current = await fetchEvent(row.booking_uid)
      // Still present and live (e.g. only beyond the page cap): leave it.
      if (current !== 'missing' && current && !current.cancelled) continue
      if (!row.start_time || !row.end_time || !row.attendee_email) continue
      const processed = await recordChange(admin, {
        action: 'cancelled',
        storedVersion: row.updated_at,
        eventId: row.booking_uid,
        start: row.start_time,
        end: row.end_time,
        eventKey: meetingTypeForKey(row.event_key)?.key ?? null,
        eventTypeId: null,
        eventLabel: row.event_label ?? 'Lawmatics event',
        person: { name: row.attendee_name ?? '', email: row.attendee_email, phone: null },
        leadId: row.linked_lead_id,
      })
      if (processed) result.cancelled++
    } catch (error) {
      result.failed++
      console.error('[lawmatics-calendar] cancellation check failed', { eventId: row.booking_uid, error })
    }
  }

  return result
}
