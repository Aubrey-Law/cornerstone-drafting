import {
  meetingTypeForCalSlug,
  meetingTypeForKey,
  type MeetingTypeKey,
  type SchedulingMeetingType,
} from '@/lib/scheduling'
import type {
  CalcomBookingStatus,
  CalcomTriggerEvent,
  CalcomWebhookBody,
  CalcomWebhookPayload,
} from '@/lib/calcom/types'
import { firstString, stringValue } from '@/lib/bookings/normalize'

export {
  firstString,
  formatAppointmentDate,
  splitAttendeeName,
  stringValue,
} from '@/lib/bookings/normalize'

const EVENT_LABELS: Record<string, string> = {
  discoverycall: 'Discovery Call',
  pmps: 'Peace of Mind Planning Session',
  'draft-review': 'Draft Review',
  'signing-appointment': 'Signing Appointment',
}

export function responseString(payload: CalcomWebhookPayload, keys: string[]): string | null {
  const responses = payload.responses ?? {}
  const customInputs = payload.customInputs ?? {}
  const normalizedKeys = keys.map(key => key.toLowerCase())

  for (const [key, entry] of Object.entries(responses)) {
    const value = typeof entry === 'object' && entry !== null && 'value' in entry
      ? (entry as { value?: unknown }).value
      : entry
    const label = typeof entry === 'object' && entry !== null && 'label' in entry
      ? (entry as { label?: string }).label
      : null
    const haystack = [key, label].filter(Boolean).join(' ').toLowerCase()
    if (normalizedKeys.some(needle => haystack.includes(needle))) {
      const text = stringValue(value)
      if (text) return text
    }
  }

  for (const [key, value] of Object.entries(customInputs)) {
    const normalized = key.toLowerCase()
    if (normalizedKeys.some(needle => normalized.includes(needle))) {
      const text = stringValue(value)
      if (text) return text
    }
  }

  return null
}

export function bookingStatusFor(triggerEvent: CalcomTriggerEvent): CalcomBookingStatus {
  if (triggerEvent === 'BOOKING_CANCELLED') return 'cancelled'
  if (triggerEvent === 'BOOKING_RESCHEDULED') return 'rescheduled'
  return 'scheduled'
}

export function resolveMeetingType(payload: CalcomWebhookPayload): SchedulingMeetingType | null {
  const metadata = payload.metadata ?? {}
  return (
    meetingTypeForKey(stringValue(metadata.eventKey)) ??
    meetingTypeForCalSlug(stringValue(metadata.eventSlug)) ??
    meetingTypeForCalSlug(stringValue(payload.type))
  )
}

export interface ParsedCalcomBooking {
  triggerEvent: CalcomTriggerEvent
  bookingUid: string
  bookingId: string | null
  /** Original booking uid when this delivery is a reschedule. */
  rescheduleUid: string | null
  attendeeEmail: string
  attendeeName: string
  eventKey: MeetingTypeKey | null
  eventSlug: string
  eventLabel: string
  startTime: string | null
  endTime: string | null
  metadataLeadId: string | null
  metadataMatterId: string | null
  rawBody: CalcomWebhookBody
}

export function parseCalcomWebhook(body: CalcomWebhookBody): ParsedCalcomBooking | null {
  const payload = body.payload ?? {}
  const bookingUid = payload.uid ?? payload.bookingUid
  if (!bookingUid) return null

  const attendees = payload.attendees ?? []
  const meetingType = resolveMeetingType(payload)
  const eventSlug = payload.type ?? meetingType?.eventSlug ?? ''

  return {
    triggerEvent: body.triggerEvent as CalcomTriggerEvent,
    bookingUid,
    bookingId: payload.bookingId != null ? String(payload.bookingId) : null,
    rescheduleUid: body.triggerEvent === 'BOOKING_RESCHEDULED' ? stringValue(payload.rescheduleUid) : null,
    attendeeEmail: firstString(attendees[0]?.email, responseString(payload, ['email']))?.toLowerCase() ?? '',
    attendeeName: firstString(attendees[0]?.name, responseString(payload, ['name'])) ?? '',
    eventKey: meetingType?.key ?? null,
    eventSlug,
    eventLabel: meetingType?.label ?? EVENT_LABELS[eventSlug] ?? payload.title ?? eventSlug,
    startTime: payload.startTime ?? null,
    endTime: payload.endTime ?? null,
    metadataLeadId: stringValue(payload.metadata?.leadId),
    metadataMatterId: stringValue(payload.metadata?.matterId),
    rawBody: body,
  }
}

export function shouldCreateLeadFromBooking(
  triggerEvent: CalcomTriggerEvent,
  eventKey: MeetingTypeKey | null,
): boolean {
  if (triggerEvent !== 'BOOKING_CREATED') return false
  return eventKey === 'discovery_call' || eventKey === 'pmps'
}
