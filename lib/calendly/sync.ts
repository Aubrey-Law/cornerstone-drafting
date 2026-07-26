import { processBookingEvent } from '@/lib/bookings/sync'
import type { ParsedCalendlyBooking } from '@/lib/calendly/normalize'

export async function processCalendlyWebhook(parsed: ParsedCalendlyBooking): Promise<void> {
  await processBookingEvent({
    provider: 'calendly',
    providerLabel: 'Calendly',
    leadSource: 'calendly',
    action: parsed.action,
    triggerEvent: parsed.event,
    bookingUid: parsed.bookingUid,
    bookingId: null,
    attendeeEmail: parsed.attendeeEmail,
    attendeeName: parsed.attendeeName,
    attendeePhone: parsed.attendeePhone,
    eventKey: parsed.eventKey,
    eventSlug: parsed.eventSlug,
    eventLabel: parsed.eventLabel,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    metadataLeadId: parsed.metadataLeadId,
    metadataMatterId: parsed.metadataMatterId,
    rawBody: parsed.rawBody,
    status: parsed.status,
  })
}
