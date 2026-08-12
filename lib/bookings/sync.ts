import { getAdminClient } from '@/lib/supabaseAdmin'
import type { MeetingTypeKey } from '@/lib/scheduling'
import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'
import { recordPmpsAnchor } from '@/lib/bookings/pmpsAnchor'
import {
  findLeadByEmail,
  findLeadById,
  findMatterIdByEmail,
  matterExists,
  type LeadLookupRow,
} from '@/lib/bookings/link'
import { formatAppointmentDate, splitAttendeeName } from '@/lib/bookings/normalize'
import { createStandingIntakeVersion } from '@/lib/intake/standingLinks'

type AdminClient = ReturnType<typeof getAdminClient>

export type BookingProvider = 'calcom' | 'calendly'

export type BookingAction = 'created' | 'rescheduled' | 'cancelled' | 'superseded'

export type BookingStatus = 'scheduled' | 'rescheduled' | 'cancelled' | 'superseded'

export interface ProcessBookingInput {
  provider: BookingProvider
  /** Human-facing provider name used in note/activity copy ('Cal.com', 'Calendly'). */
  providerLabel: string
  /** Written to client_intake.lead_source on auto-created leads. */
  leadSource: string
  action: BookingAction
  /** Raw provider event name, stored verbatim in trigger_event. */
  triggerEvent: string
  bookingUid: string
  bookingId: string | null
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
  rawBody: unknown
  status: BookingStatus
}

function shouldCreateLead(action: BookingAction, eventKey: MeetingTypeKey | null): boolean {
  if (action !== 'created') return false
  return eventKey === 'discovery_call' || eventKey === 'pmps'
}

async function createLeadFromBooking(input: {
  admin: AdminClient
  providerLabel: string
  leadSource: string
  bookingUid: string
  attendeeEmail: string
  attendeeName: string | null
  attendeePhone: string | null
  eventLabel: string
  startTime: string | null
}): Promise<LeadLookupRow | null> {
  const {
    admin,
    providerLabel,
    leadSource,
    bookingUid,
    attendeeEmail,
    attendeeName,
    attendeePhone,
    eventLabel,
    startTime,
  } = input
  const { firstName, lastName } = splitAttendeeName(attendeeName, attendeeEmail)
  const fullName = [firstName, lastName].filter(part => part && part !== 'Unknown').join(' ').trim()
  const notes = [
    `Created automatically from ${providerLabel} booking: ${eventLabel}`,
    startTime ? `Appointment time: ${startTime}` : null,
    `${providerLabel} booking UID: ${bookingUid}`,
  ].filter(Boolean).join('\n')

  const { data, error } = await admin
    .from('client_intake')
    .insert({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName || `${firstName} ${lastName}`.trim(),
      email: attendeeEmail,
      phone: attendeePhone,
      status: 'in_progress',
      lead_status: 'lead',
      lead_source: leadSource,
      // Same standing link every hand-created lead gets, so the intake card can
      // copy, email, or text it the moment the booking lands.
      intake_link_version: createStandingIntakeVersion(),
      intake_link_created_at: new Date().toISOString(),
      intake_link_revoked_at: null,
    })
    .select('id, lead_status')
    .single()

  if (error) throw error
  if (!data) return null

  const lead = data as LeadLookupRow

  await admin.from('lead_activity').insert({
    lead_id: lead.id,
    event_type: 'created',
    title: `Lead created from ${providerLabel}`,
    detail: notes,
    actor_id: null,
  })

  return lead
}

async function syncLeadBooking(input: {
  admin: AdminClient
  providerLabel: string
  action: BookingAction
  lead: LeadLookupRow
  bookingUid: string
  eventKey: MeetingTypeKey | null
  eventLabel: string
  startTime: string | null
}) {
  const { admin, providerLabel, action, lead, bookingUid, eventKey, eventLabel, startTime } = input

  if (action === 'cancelled') {
    await admin.from('lead_activity').insert({
      lead_id: lead.id,
      event_type: 'note',
      title: 'Appointment cancelled',
      detail: `${eventLabel} (${providerLabel} booking ${bookingUid})`,
      actor_id: null,
    })
    return
  }

  const verb = action === 'rescheduled' ? 'Rescheduled' : 'Booked'
  const whenDetail = startTime ? ` — ${formatAppointmentDate(startTime)}` : ''

  await admin.from('lead_activity').insert({
    lead_id: lead.id,
    event_type: 'consult_scheduled',
    title: `${verb}: ${eventLabel}`,
    detail: `${verb} through ${providerLabel}${whenDetail}${eventKey ? ` (${eventKey})` : ''}`,
    actor_id: null,
  })
}

async function syncMatterBooking(input: {
  admin: AdminClient
  providerLabel: string
  action: BookingAction
  matterId: string
  bookingUid: string
  eventKey: MeetingTypeKey | null
  eventLabel: string
  startTime: string | null
}) {
  const { admin, providerLabel, action, matterId, bookingUid, eventKey, eventLabel, startTime } = input

  if ((action === 'created' || action === 'rescheduled') && startTime) {
    const startTimestamp = new Date(startTime).toISOString()
    if (eventKey === 'signing_appointment') {
      await admin
        .from('matter_details')
        .upsert(
          { client_id: matterId, scheduled_signing_date: startTimestamp },
          { onConflict: 'client_id' },
        )
    }
  }

  const body = action === 'cancelled'
    ? `Appointment cancelled: ${eventLabel}`
    : action === 'rescheduled'
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

export async function processBookingEvent(input: ProcessBookingInput): Promise<void> {
  const admin = getAdminClient()
  const {
    provider,
    providerLabel,
    leadSource,
    action,
    triggerEvent,
    bookingUid,
    bookingId,
    attendeeEmail,
    attendeeName,
    attendeePhone,
    eventKey,
    eventSlug,
    eventLabel,
    startTime,
    endTime,
    metadataLeadId,
    metadataMatterId,
    rawBody,
    status,
  } = input

  let lead: LeadLookupRow | null = null
  let matterId: string | null = null

  try {
    if (metadataLeadId) lead = await findLeadById(admin, metadataLeadId)
    if (!lead && attendeeEmail) lead = await findLeadByEmail(admin, attendeeEmail)
    if (!lead && attendeeEmail && shouldCreateLead(action, eventKey)) {
      lead = await createLeadFromBooking({
        admin,
        providerLabel,
        leadSource,
        bookingUid,
        attendeeEmail,
        attendeeName,
        attendeePhone,
        eventLabel,
        startTime,
      })
    }
  } catch (err) {
    console.error(`[${provider}] error matching lead for`, attendeeEmail, err)
  }

  try {
    if (metadataMatterId && await matterExists(admin, metadataMatterId)) matterId = metadataMatterId
    if (!matterId && attendeeEmail) matterId = await findMatterIdByEmail(admin, attendeeEmail)
  } catch (err) {
    console.error(`[${provider}] error matching matter for`, attendeeEmail, err)
  }

  const now = new Date().toISOString()
  const unresolvedReason = lead || matterId ? null : 'no_match'

  await admin.from('external_bookings').upsert({
    provider,
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
  }, { onConflict: 'provider,booking_uid' })

  // A superseded booking was replaced by a reschedule; the paired 'created'
  // delivery carries the real state, so no notes/activity/date updates here.
  if (action === 'superseded') return

  if (lead) {
    try {
      await syncLeadBooking({
        admin,
        providerLabel,
        action,
        lead,
        bookingUid,
        eventKey,
        eventLabel,
        startTime,
      })
    } catch (err) {
      console.error(`[${provider}] lead sync error for`, lead.id, err)
    }
  }

  if (matterId) {
    try {
      await syncMatterBooking({
        admin,
        providerLabel,
        action,
        matterId,
        bookingUid,
        eventKey,
        eventLabel,
        startTime,
      })
    } catch (err) {
      console.error(`[${provider}] matter sync error for`, matterId, err)
    }
  }

  // Outside the `matterId` branch: that id is hired-only, and under the v3 SLA
  // the planning session is booked while the record is still a lead. See
  // lib/bookings/pmpsAnchor.ts.
  if (eventKey === 'pmps' && startTime && (action === 'created' || action === 'rescheduled')) {
    try {
      await recordPmpsAnchor(admin, { leadId: lead?.id ?? null, matterId, startIso: startTime })
    } catch (err) {
      console.error(`[${provider}] pmps anchor error for`, lead?.id ?? matterId, err)
    }
  }

  // The discovery call is the earlier anchor of the same pre-engagement clock,
  // and it reaches us through exactly this webhook whenever the client books
  // from cal.com rather than from the firm's own scheduling page. Stamping it
  // only on the scheduling page left the provider path writing an appointment
  // row and nothing else: no anchor, so the four `relative_to='discovery_call'`
  // tasks stayed undated, and no stage move, so the lead sat in `new_lead` on a
  // 1-day attorney SLA reporting a breach nobody was late on.
  //
  // `cancelled` and `superseded` are excluded for the reason the scheduling page
  // excludes a no-show: the tasks due at discovery_call+0 assume the
  // conversation happened.
  if (eventKey === 'discovery_call' && startTime && (action === 'created' || action === 'rescheduled')) {
    try {
      await recordDiscoveryAnchor(admin, {
        leadId: lead?.id ?? null,
        matterId,
        startIso: startTime,
        overwrite: action === 'rescheduled',
      })
    } catch (err) {
      console.error(`[${provider}] discovery anchor error for`, lead?.id ?? matterId, err)
    }
  }
}
