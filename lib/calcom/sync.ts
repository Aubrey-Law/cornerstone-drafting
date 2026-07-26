import type { MeetingTypeKey } from '@/lib/scheduling'
import { processBookingEvent, type BookingAction } from '@/lib/bookings/sync'
import { responseString } from '@/lib/calcom/normalize'
import type {
  CalcomTriggerEvent,
  CalcomWebhookBody,
  CalcomWebhookPayload,
} from '@/lib/calcom/types'

const ACTION_FOR_TRIGGER: Record<CalcomTriggerEvent, BookingAction> = {
  BOOKING_CREATED: 'created',
  BOOKING_RESCHEDULED: 'rescheduled',
  BOOKING_CANCELLED: 'cancelled',
}

export interface ProcessCalcomWebhookInput {
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
  payload: CalcomWebhookPayload
  rawBody: CalcomWebhookBody
  status: 'scheduled' | 'rescheduled' | 'cancelled'
}

export async function processCalcomWebhook(input: ProcessCalcomWebhookInput): Promise<void> {
  await processBookingEvent({
    provider: 'calcom',
    providerLabel: 'Cal.com',
    leadSource: 'calcom',
    action: ACTION_FOR_TRIGGER[input.triggerEvent],
    triggerEvent: input.triggerEvent,
    bookingUid: input.bookingUid,
    bookingId: input.bookingId,
    attendeeEmail: input.attendeeEmail,
    attendeeName: input.attendeeName,
    attendeePhone: responseString(input.payload, ['phone', 'telephone', 'mobile']),
    eventKey: input.eventKey,
    eventSlug: input.eventSlug,
    eventLabel: input.eventLabel,
    startTime: input.startTime,
    endTime: input.endTime,
    metadataLeadId: input.metadataLeadId,
    metadataMatterId: input.metadataMatterId,
    rawBody: input.rawBody,
    status: input.status,
  })
}
