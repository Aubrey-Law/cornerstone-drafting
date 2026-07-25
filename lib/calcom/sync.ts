import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MeetingTypeKey } from '@/lib/scheduling'
import {
  findLeadByEmail,
  findLeadById,
  findMatterIdByEmail,
  matterExists,
} from '@/lib/calcom/link'
import {
  formatAppointmentDate,
  responseString,
  shouldCreateLeadFromBooking,
  splitAttendeeName,
} from '@/lib/calcom/normalize'
import type {
  CalcomTriggerEvent,
  CalcomWebhookBody,
  CalcomWebhookPayload,
  LeadLookupRow,
} from '@/lib/calcom/types'

type AdminClient = ReturnType<typeof getAdminClient>

async function createLeadFromBooking(input: {
  admin: AdminClient
  payload: CalcomWebhookPayload
  bookingUid: string
  attendeeEmail: string
  attendeeName: string | null
  eventKey: MeetingTypeKey | null
  eventLabel: string
  startTime: string | null
}): Promise<LeadLookupRow | null> {
  const { admin, payload, bookingUid, attendeeEmail, attendeeName, eventKey, eventLabel, startTime } = input
  const { firstName, lastName } = splitAttendeeName(attendeeName, attendeeEmail)
  const phone = responseString(payload, ['phone', 'telephone', 'mobile'])
  const fullName = [firstName, lastName].filter(part => part && part !== 'Unknown').join(' ').trim()
  const notes = [
    `Created automatically from Cal.com booking: ${eventLabel}`,
    startTime ? `Appointment time: ${startTime}` : null,
    `Cal.com booking UID: ${bookingUid}`,
  ].filter(Boolean).join('\n')

  const { data, error } = await admin
    .from('client_intake')
    .insert({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName || `${firstName} ${lastName}`.trim(),
      email: attendeeEmail,
      phone,
      status: 'in_progress',
      lead_status: 'lead',
      lead_source: 'calcom',
    })
    .select('id, lead_status')
    .single()

  if (error) throw error
  if (!data) return null

  const lead = data as LeadLookupRow

  await admin.from('lead_activity').insert({
    lead_id: lead.id,
    event_type: 'created',
    title: 'Lead created from Cal.com',
    detail: notes,
    actor_id: null,
  })

  return lead
}

async function syncLeadBooking(input: {
  admin: AdminClient
  triggerEvent: CalcomTriggerEvent
  lead: LeadLookupRow
  bookingUid: string
  eventKey: MeetingTypeKey | null
  eventLabel: string
  startTime: string | null
}) {
  const { admin, triggerEvent, lead, bookingUid, eventKey, eventLabel, startTime } = input

  if (triggerEvent === 'BOOKING_CANCELLED') {
    await admin.from('lead_activity').insert({
      lead_id: lead.id,
      event_type: 'note',
      title: 'Appointment cancelled',
      detail: `${eventLabel} (Cal.com booking ${bookingUid})`,
      actor_id: null,
    })
    return
  }

  const action = triggerEvent === 'BOOKING_RESCHEDULED' ? 'Rescheduled' : 'Booked'
  const whenDetail = startTime ? ` — ${formatAppointmentDate(startTime)}` : ''

  await admin.from('lead_activity').insert({
    lead_id: lead.id,
    event_type: 'consult_scheduled',
    title: `${action}: ${eventLabel}`,
    detail: `${action} through Cal.com${whenDetail}${eventKey ? ` (${eventKey})` : ''}`,
    actor_id: null,
  })
}

async function syncMatterBooking(input: {
  admin: AdminClient
  triggerEvent: CalcomTriggerEvent
  matterId: string
  bookingUid: string
  eventKey: MeetingTypeKey | null
  eventLabel: string
  startTime: string | null
}) {
  const { admin, triggerEvent, matterId, bookingUid, eventKey, eventLabel, startTime } = input

  if (
    (triggerEvent === 'BOOKING_CREATED' || triggerEvent === 'BOOKING_RESCHEDULED') &&
    startTime
  ) {
    const startTimestamp = new Date(startTime).toISOString()
    const dateOnly = startTimestamp.split('T')[0]
    if (eventKey === 'signing_appointment') {
      await admin
        .from('matter_details')
        .upsert(
          { client_id: matterId, scheduled_signing_date: startTimestamp },
          { onConflict: 'client_id' },
        )
    } else if (eventKey === 'pmps') {
      await admin
        .from('matter_details')
        .upsert(
          { client_id: matterId, design_meeting_date: dateOnly },
          { onConflict: 'client_id' },
        )
    }
  }

  const body = triggerEvent === 'BOOKING_CANCELLED'
    ? `Appointment cancelled: ${eventLabel}`
    : triggerEvent === 'BOOKING_RESCHEDULED'
      ? `Appointment rescheduled: ${eventLabel}${startTime ? ` → ${formatAppointmentDate(startTime)}` : ''}`
      : `Appointment booked: ${eventLabel}${startTime ? ` — ${formatAppointmentDate(startTime)}` : ''}`

  await admin.from('matter_notes').insert({
    matter_id: matterId,
    note_type: 'internal',
    body,
    author: 'System',
    calcom_booking_uid: bookingUid,
  })
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
  const admin = getAdminClient()
  const {
    triggerEvent,
    bookingUid,
    bookingId,
    attendeeEmail,
    attendeeName,
    eventKey,
    eventSlug,
    eventLabel,
    startTime,
    endTime,
    metadataLeadId,
    metadataMatterId,
    payload,
    rawBody,
    status,
  } = input

  let lead: LeadLookupRow | null = null
  let matterId: string | null = null

  try {
    if (metadataLeadId) lead = await findLeadById(admin, metadataLeadId)
    if (!lead && attendeeEmail) lead = await findLeadByEmail(admin, attendeeEmail)
    if (!lead && attendeeEmail && shouldCreateLeadFromBooking(triggerEvent, eventKey)) {
      lead = await createLeadFromBooking({
        admin,
        payload,
        bookingUid,
        attendeeEmail,
        attendeeName,
        eventKey,
        eventLabel,
        startTime,
      })
    }
  } catch (err) {
    console.error('[calcom] error matching lead for', attendeeEmail, err)
  }

  try {
    if (metadataMatterId && await matterExists(admin, metadataMatterId)) matterId = metadataMatterId
    if (!matterId && attendeeEmail) matterId = await findMatterIdByEmail(admin, attendeeEmail)
  } catch (err) {
    console.error('[calcom] error matching matter for', attendeeEmail, err)
  }

  const now = new Date().toISOString()
  const unresolvedReason = lead || matterId ? null : 'no_match'

  await admin.from('calcom_bookings').upsert({
    booking_uid: bookingUid,
    booking_id: bookingId,
    trigger_event: triggerEvent,
    event_key: eventKey,
    event_slug: eventSlug || null,
    event_label: eventLabel || null,
    status,
    start_time: startTime,
    end_time: endTime,
    attendee_email: attendeeEmail || null,
    attendee_name: attendeeName || null,
    linked_lead_id: lead?.id ?? null,
    linked_matter_id: matterId,
    unresolved_reason: unresolvedReason,
    raw_payload: rawBody,
    updated_at: now,
  }, { onConflict: 'booking_uid' })

  if (lead) {
    try {
      await syncLeadBooking({
        admin,
        triggerEvent,
        lead,
        bookingUid,
        eventKey,
        eventLabel,
        startTime,
      })
    } catch (err) {
      console.error('[calcom] lead sync error for', lead.id, err)
    }
  }

  if (matterId) {
    try {
      await syncMatterBooking({
        admin,
        triggerEvent,
        matterId,
        bookingUid,
        eventKey,
        eventLabel,
        startTime,
      })
    } catch (err) {
      console.error('[calcom] matter sync error for', matterId, err)
    }
  }
}
