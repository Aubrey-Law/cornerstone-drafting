import {
  MEETING_TYPE_KEYS,
  meetingTypeForKey,
  type MeetingTypeKey,
  type SchedulingMeetingType,
} from '@/lib/scheduling'
import { firstString, stringValue } from '@/lib/bookings/normalize'
import type { BookingAction, BookingStatus } from '@/lib/bookings/sync'
import {
  CALENDLY_EVENTS,
  type CalendlyEvent,
  type CalendlyWebhookBody,
  type CalendlyWebhookPayload,
} from '@/lib/calendly/types'

/** Last path segment of a Calendly resource URI (invitee, event type, …). */
export function uriUuid(uri: string | null | undefined): string | null {
  const trimmed = stringValue(uri)
  if (!trimmed) return null
  const segment = trimmed.split('/').filter(Boolean).pop()
  return segment ?? null
}

// CALENDLY_EVENT_TYPE_MAP is a JSON object of event-type UUID → meeting type
// key, e.g. {"abc-123":"discovery_call"}. UUIDs are stable across event
// renames in Calendly, and the map keeps the webhook hot path free of API
// calls. Parsed once per process; malformed JSON logs once and disables the map.
let cachedEventTypeMap: Record<string, MeetingTypeKey> | null | undefined

function eventTypeMap(): Record<string, MeetingTypeKey> | null {
  if (cachedEventTypeMap !== undefined) return cachedEventTypeMap
  const raw = process.env.CALENDLY_EVENT_TYPE_MAP?.trim()
  if (!raw) {
    cachedEventTypeMap = null
    return cachedEventTypeMap
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const map: Record<string, MeetingTypeKey> = {}
    for (const [uuid, key] of Object.entries(parsed)) {
      const meetingType = meetingTypeForKey(typeof key === 'string' ? key : null)
      if (meetingType) map[uuid.toLowerCase()] = meetingType.key
    }
    cachedEventTypeMap = map
  } catch {
    console.error(
      '[calendly] CALENDLY_EVENT_TYPE_MAP is not valid JSON; falling back to event-name matching',
    )
    cachedEventTypeMap = null
  }
  return cachedEventTypeMap
}

export function resolveCalendlyMeetingType(
  payload: CalendlyWebhookPayload,
): SchedulingMeetingType | null {
  const eventTypeUuid = uriUuid(payload.scheduled_event?.event_type)
  if (eventTypeUuid) {
    const mappedKey = eventTypeMap()?.[eventTypeUuid.toLowerCase()]
    if (mappedKey) return meetingTypeForKey(mappedKey)
  }

  const eventName = stringValue(payload.scheduled_event?.name)?.toLowerCase()
  if (eventName) {
    for (const key of MEETING_TYPE_KEYS) {
      const meetingType = meetingTypeForKey(key)
      if (meetingType && meetingType.label.toLowerCase() === eventName) return meetingType
    }
  }

  return null
}

function trackingId(payload: CalendlyWebhookPayload, field: 'leadId' | 'matterId'): string | null {
  const utmContent = stringValue(payload.tracking?.utm_content)
  if (!utmContent) return null
  const match = utmContent.match(new RegExp(`${field}[:=]\\s*([0-9a-fA-F-]{36})`, 'i'))
  return match?.[1] ?? null
}

function attendeePhone(payload: CalendlyWebhookPayload): string | null {
  const reminderNumber = stringValue(payload.text_reminder_number)
  if (reminderNumber) return reminderNumber
  for (const entry of payload.questions_and_answers ?? []) {
    if (entry.question?.toLowerCase().includes('phone')) {
      const answer = stringValue(entry.answer)
      if (answer) return answer
    }
  }
  return null
}

function actionFor(event: CalendlyEvent, payload: CalendlyWebhookPayload): BookingAction {
  if (event === 'invitee.canceled') {
    // A reschedule cancels the old invitee and creates a new one; the old row
    // is superseded history, not a client cancellation.
    return payload.rescheduled === true ? 'superseded' : 'cancelled'
  }
  return stringValue(payload.old_invitee) ? 'rescheduled' : 'created'
}

const STATUS_FOR_ACTION: Record<BookingAction, BookingStatus> = {
  created: 'scheduled',
  rescheduled: 'rescheduled',
  cancelled: 'cancelled',
  superseded: 'superseded',
}

export interface ParsedCalendlyBooking {
  event: CalendlyEvent
  action: BookingAction
  status: BookingStatus
  bookingUid: string
  attendeeEmail: string
  attendeeName: string
  attendeePhone: string | null
  eventKey: MeetingTypeKey | null
  eventSlug: string
  eventLabel: string
  startTime: string | null
  endTime: string | null
  metadataLeadId: string | null
  metadataMatterId: string | null
  rawBody: CalendlyWebhookBody
}

export function parseCalendlyWebhook(body: CalendlyWebhookBody): ParsedCalendlyBooking | null {
  const event = body.event as CalendlyEvent
  if (!CALENDLY_EVENTS.includes(event)) return null

  const payload = body.payload ?? {}
  // The invitee UUID, not the scheduled_event UUID: a reschedule creates a new
  // invitee, so the old and new bookings land in separate rows and the paired
  // canceled/created deliveries never contend on one row.
  const bookingUid = uriUuid(payload.uri)
  if (!bookingUid) return null

  const meetingType = resolveCalendlyMeetingType(payload)
  const eventTypeUuid = uriUuid(payload.scheduled_event?.event_type)
  const action = actionFor(event, payload)

  return {
    event,
    action,
    status: STATUS_FOR_ACTION[action],
    bookingUid,
    attendeeEmail: firstString(payload.email)?.toLowerCase() ?? '',
    attendeeName: firstString(payload.name) ?? '',
    attendeePhone: attendeePhone(payload),
    eventKey: meetingType?.key ?? null,
    eventSlug: meetingType?.eventSlug ?? eventTypeUuid ?? '',
    eventLabel: meetingType?.label
      ?? stringValue(payload.scheduled_event?.name)
      ?? eventTypeUuid
      ?? '',
    startTime: stringValue(payload.scheduled_event?.start_time),
    endTime: stringValue(payload.scheduled_event?.end_time),
    metadataLeadId: trackingId(payload, 'leadId'),
    metadataMatterId: trackingId(payload, 'matterId'),
    rawBody: body,
  }
}
