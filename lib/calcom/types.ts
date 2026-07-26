export const CALCOM_MUTATING_EVENTS = [
  'BOOKING_CREATED',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLED',
] as const

export type CalcomTriggerEvent = (typeof CALCOM_MUTATING_EVENTS)[number]

export type CalcomBookingStatus = 'scheduled' | 'rescheduled' | 'cancelled'

export interface CalcomAttendee {
  email?: string
  name?: string
}

export interface CalcomResponseValue {
  label?: string
  value?: unknown
}

export interface CalcomWebhookPayload {
  uid?: string
  bookingUid?: string
  bookingId?: string | number
  type?: string
  title?: string
  startTime?: string
  endTime?: string
  attendees?: CalcomAttendee[]
  metadata?: Record<string, unknown>
  responses?: Record<string, CalcomResponseValue | unknown>
  customInputs?: Record<string, unknown>
  cancellationReason?: string
}

export interface CalcomWebhookBody {
  triggerEvent: string
  payload?: CalcomWebhookPayload
}

// Moved to lib/bookings/link.ts; re-exported until the Cal.com removal PR.
export type { LeadLookupRow } from '@/lib/bookings/link'
