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

const EVENT_LABELS: Record<string, string> = {
  discoverycall: 'Discovery Call',
  pmps: 'Peace of Mind Planning Session',
  'draft-review': 'Draft Review',
  'signing-appointment': 'Signing Appointment',
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return null
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

export function splitAttendeeName(
  name: string | null,
  email: string,
): { firstName: string; lastName: string } {
  const cleaned = name?.replace(/\s+/g, ' ').trim()
  if (cleaned) {
    const parts = cleaned.split(' ')
    return {
      firstName: parts[0] ?? 'Unknown',
      lastName: parts.slice(1).join(' ') || 'Unknown',
    }
  }

  const localPart = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (localPart) {
    const parts = localPart.split(/\s+/)
    return {
      firstName: parts[0] ?? 'Unknown',
      lastName: parts.slice(1).join(' ') || 'Unknown',
    }
  }

  return { firstName: 'Unknown', lastName: 'Unknown' }
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

export function formatAppointmentDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export interface ParsedCalcomBooking {
  triggerEvent: CalcomTriggerEvent
  bookingUid: string
  bookingId: string | null
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
