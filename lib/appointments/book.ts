import 'server-only'
import { firmOfficeAddress } from './officeAddress'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { findLeadByEmail, findMatterIdByEmail } from '@/lib/calcom/link'
import { sendEmail } from '@/lib/email/send'
import { loadFirmSettings } from '@/lib/firmSettings'
import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'
import { recordPmpsAnchor } from '@/lib/bookings/pmpsAnchor'
import { createStandingIntakeVersion } from '@/lib/intake/standingLinks'
import { portalUrl, appUrl } from '@/lib/urls'
import { isSlotAvailable } from './availability'
import { type BookingAnswer, formatBookingAnswers } from './bookingQuestions'
import { fetchAllBusy, AvailabilityUnavailableError } from './calendarBusy'
import {
  cancelAppointmentEvent,
  createAppointmentEvent,
  rescheduleAppointmentEvent,
} from './calendarSync'
import { runPostBookingAutomation } from './automation'
import { formatWhen } from './emailFormat'
import { buildAppointmentConfirmationEmail, officeAddressLine } from './confirmationEmail'
import { delegateAppointmentConfirmation } from './delegateConfirmation'
import { createManageToken } from './manageTokens'
import type { OnlineMeetingProvider } from './calendarTypes'
import {
  cancelAppointmentTeamsMeeting,
  createAppointmentTeamsMeeting,
  rescheduleAppointmentTeamsMeeting,
} from './teamsMeeting'
import { getSchedulingSettings } from './settings'
import {
  effectiveWeeklyHours,
  normalizeBookingNames,
  resolveLocationType,
  type AppointmentRow,
  type AppointmentSource,
  type AppointmentType,
  type Interval,
} from './types'

type AdminClient = ReturnType<typeof getAdminClient>
type LeadRow = { id: string; lead_status: string | null }

export class SlotTakenError extends Error {
  constructor() {
    super('That time was just taken. Please pick another slot.')
    this.name = 'SlotTakenError'
  }
}

export { AvailabilityUnavailableError }

export class BookingPausedError extends Error {
  constructor() {
    super('Online booking is temporarily paused. Please call or email us to schedule.')
    this.name = 'BookingPausedError'
  }
}

export interface BookAppointmentInput {
  type: AppointmentType
  startIso: string
  attendeeFirstName: string
  attendeeLastName: string
  attendeeEmail: string
  attendeePhone?: string | null
  notes?: string | null
  /** Answers to the type's booking questions, already validated. */
  bookingAnswers?: BookingAnswer[]
  /** Chosen meeting format; must be in type.locationTypes (else the default is used). */
  locationType?: string | null
  /** Optional spouse/partner — invited to the event and cc'd on emails. */
  secondAttendeeFirstName?: string | null
  secondAttendeeLastName?: string | null
  secondAttendeeEmail?: string | null
  source: AppointmentSource
  bookedByUserId?: string | null
  /**
   * Which service hosts a virtual meeting. Defaults to Google Meet; staff can
   * ask for Microsoft Teams. Ignored unless the format is virtual.
   */
  videoProvider?: OnlineMeetingProvider | null
}

export interface BookAppointmentResult {
  appointmentId: string
  startIso: string
  endIso: string
  manageToken: string
  /** Set when Teams was asked for and could not be created (Meet was used). */
  teamsMeetingError?: string
}

const DAY_MS = 86_400_000

/** Postgres exclusion-constraint violation (double-booking race). */
function isOverlapViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '23P01' || /appointments_no_overlap/.test(error.message ?? '')
}

async function createLeadFromAppointment(input: {
  admin: AdminClient
  attendeeName: string
  attendeeFirstName: string
  attendeeLastName: string
  attendeeEmail: string
  attendeePhone: string | null
  typeLabel: string
  startIso: string
}): Promise<LeadRow | null> {
  const { admin, attendeeName, attendeeFirstName, attendeeLastName, attendeeEmail, attendeePhone, typeLabel, startIso } = input

  const { data, error } = await admin
    .from('client_intake')
    .insert({
      first_name: attendeeFirstName,
      last_name: attendeeLastName,
      full_name: attendeeName,
      email: attendeeEmail,
      phone: attendeePhone,
      status: 'in_progress',
      lead_status: 'lead',
      lead_source: 'scheduler',
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
  const lead = data as LeadRow

  await admin.from('lead_activity').insert({
    lead_id: lead.id,
    event_type: 'created',
    title: 'Lead created from scheduling page',
    detail: `Created automatically from booking: ${typeLabel}\nAppointment time: ${startIso}`,
    actor_id: null,
  })

  // The same conflict check every hand-created lead gets (lib/leads/createLead.ts).
  try {
    const { scheduleConflictCheck } = await import('@/lib/conflicts/server')
    scheduleConflictCheck(lead.id)
  } catch (error) {
    console.error('[booking] conflict check not scheduled', { leadId: lead.id, cause: error instanceof Error ? error.message : String(error) })
  }

  return lead
}

async function recordActivity(input: {
  admin: AdminClient
  action: 'Booked' | 'Rescheduled' | 'Cancelled' | 'No-show'
  type: AppointmentType
  startIso: string | null
  leadId: string | null
  matterId: string | null
  appointmentId: string
  /** Booked only: what the client (or staff) entered, kept on the record. */
  bookingAnswers?: BookingAnswer[]
  notes?: string | null
}): Promise<void> {
  const { admin, action, type, startIso, leadId, matterId, appointmentId } = input
  const when = startIso ? ` — ${formatWhen(startIso)}` : ''
  const responses = bookingResponsesText(input.bookingAnswers ?? [], input.notes ?? null)

  if (leadId) {
    try {
      await admin.from('lead_activity').insert({
        lead_id: leadId,
        event_type: action === 'Cancelled' ? 'note' : 'consult_scheduled',
        title: `${action}: ${type.label}`,
        detail: `${action} through the scheduling page${when}${responses ? `\n\n${responses}` : ''}`,
        actor_id: null,
      })
    } catch (err) {
      console.error('[appointments] lead activity failed', err)
    }
  }

  // The discovery call is the pre-engagement clock's first anchor. It hangs off
  // leadId, not matterId: findMatterIdByEmail filters to
  // relationship_status = 'hired', so a lead resolves to no matter and the block
  // below never runs for one. Only Booked/Rescheduled stamp — a no-show means
  // the two tasks due at discovery_call+0 ("Send post-discovery email",
  // "Determine fit") assume the conversation happened, so starting their 1-day
  // clock here would breach on work nobody could have done yet.
  //
  // Shared with the Cal.com/Calendly webhook rather than inlined, so a call
  // booked through the scheduling page and the same call booked through the
  // provider land identically. See lib/bookings/discoveryAnchor.ts.
  if (leadId && startIso && type.key === 'discovery_call' && (action === 'Booked' || action === 'Rescheduled')) {
    try {
      await recordDiscoveryAnchor(admin, {
        leadId,
        matterId,
        startIso,
        overwrite: action === 'Rescheduled',
      })
    } catch (err) {
      console.error('[appointments] discovery anchor failed', err)
    }
  }

  if (matterId) {
    try {
      const body =
        action === 'Cancelled'
          ? `Appointment cancelled: ${type.label}`
          : `Appointment ${action.toLowerCase()}: ${type.label}${when}`
      await admin.from('matter_notes').insert({
        matter_id: matterId,
        note_type: 'internal',
        body: `${body} (appointment ${appointmentId})${responses ? `\n\n${responses}` : ''}`,
        author: 'System',
      })

      // Mirror the Cal.com sync: key dates land on matter_details.
      if (action !== 'Cancelled' && startIso && type.key === 'signing_appointment') {
        // scheduled_signing_date is timestamptz (20260725023005). Truncating to
        // a UTC calendar day here reported the wrong signing day for any
        // evening appointment: 8pm ET is already the next day in UTC, and the
        // bare YYYY-MM-DD then parsed as midnight UTC, rendering as the
        // previous evening in ET. Store the full timestamp, as calcom/sync does.
        await admin
          .from('matter_details')
          .upsert(
            { client_id: matterId, scheduled_signing_date: new Date(startIso).toISOString() },
            { onConflict: 'client_id' },
          )
      }
    } catch (err) {
      console.error('[appointments] matter note failed', err)
    }
  }

  // The PMPS anchor sits outside the `matterId` branch on purpose: that id is
  // hired-only, and under the v3 SLA the planning session happens while the
  // record is still a lead. Keyed off the lead, it reaches the matter row a lead
  // has owned since it was created.
  if (action !== 'Cancelled' && startIso && type.key === 'pmps') {
    try {
      await recordPmpsAnchor(admin, { leadId, matterId, startIso })
    } catch (err) {
      console.error('[appointments] pmps anchor failed', err)
    }
  }
}


/** The appointment's calendar day in the firm's zone, as the calendar's `?date=` expects. */
function firmDayKey(iso: string, timezone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/** Plain-text answers + notes for the lead timeline and matter notes. */
function bookingResponsesText(answers: BookingAnswer[], notes: string | null): string {
  const parts = answers.length ? [formatBookingAnswers(answers)] : []
  if (notes?.trim()) parts.push(`Notes\n${notes.trim()}`)
  return parts.join('\n\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The client's answers and notes for the firm alert; client-supplied, so escaped. */
function alertDetailsHtml(answers: BookingAnswer[], notes: string | null): string {
  const rows = answers.map(
    a =>
      `<p style="margin:8px 0 0"><strong>${escapeHtml(a.label)}</strong><br>${escapeHtml(a.answer).replace(/\r?\n/g, '<br>')}</p>`,
  )
  if (notes) {
    rows.push(
      `<p style="margin:8px 0 0"><strong>Notes from client</strong><br>${escapeHtml(notes).replace(/\r?\n/g, '<br>')}</p>`,
    )
  }
  return rows.length ? `<div style="margin:12px 0">${rows.join('')}</div>` : ''
}

async function sendConfirmationEmails(input: {
  appointmentId: string
  type: AppointmentType
  startIso: string
  attendeeName: string
  attendeeEmail: string
  manageToken: string | null
  meetingUrl: string | null
  meetingProvider?: OnlineMeetingProvider | null
  timezone: string
  action: 'Booked' | 'Rescheduled'
  /** Spouse/partner cc'd on the client-facing email. */
  ccEmail?: string | null
  /** Staff booked it themselves — no point alerting them about it. */
  skipInternalAlert?: boolean
  /** Shown to staff in the internal alert. */
  bookingAnswers?: BookingAnswer[]
  notes?: string | null
  leadId?: string | null
  matterId?: string | null
  /** Staff who booked it; the dial sends as them. */
  actorId?: string | null
}): Promise<void> {
  const firm = await loadFirmSettings()
  const office = officeAddressLine(firm)
  const when = formatWhen(input.startIso, input.timezone)
  const verb = input.action === 'Rescheduled' ? 'rescheduled' : 'confirmed'

  // The client-facing confirmation goes through the delegation dial, whose
  // default for this action is to send at once and report. Only when the dial
  // cannot be reached at all does the booking send directly, as it always did.
  const delegated = await delegateAppointmentConfirmation({
    appointmentId: input.appointmentId,
    event: input.action === 'Rescheduled' ? 'rescheduled' : 'booked',
    manageToken: input.manageToken,
    attendeeName: input.attendeeName,
    typeLabel: input.type.label,
    when,
    leadId: input.leadId ?? null,
    matterId: input.matterId ?? null,
    actorId: input.actorId ?? null,
  })
  if (delegated === 'fallback') {
    try {
      const email = buildAppointmentConfirmationEmail({
        type: input.type,
        startIso: input.startIso,
        timezone: input.timezone,
        officeAddress: office,
        meetingUrl: input.meetingUrl,
        meetingProvider: input.meetingProvider ?? null,
        manageToken: input.manageToken,
        event: input.action === 'Rescheduled' ? 'rescheduled' : 'booked',
      })
      await sendEmail({
        category: 'appointment_confirmation',
        to: input.attendeeEmail,
        cc: input.ccEmail ?? undefined,
        subject: email.subject,
        html: email.html,
        leadId: input.leadId ?? null,
        matterId: input.matterId ?? null,
      })
    } catch (err) {
      console.error('[appointments] confirmation email failed', err)
    }
  }

  if (input.skipInternalAlert) return

  try {
    await sendEmail({
      category: 'appointment_booked_alert',
      to: ADMIN_EMAIL,
      replyTo: input.attendeeEmail,
      subject: `${input.action}: ${input.type.label} — ${input.attendeeName}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Appointment ${verb}</h2>
        <p><strong>${input.attendeeName}</strong> (${input.attendeeEmail})</p>
        <p>${input.type.label} — ${when}</p>
        ${alertDetailsHtml(input.bookingAnswers ?? [], input.notes ?? null)}
        <p><a href="${appUrl(`/admin/calendar?date=${firmDayKey(input.startIso, input.timezone)}`)}" style="color:#1a6b72">View on the calendar →</a></p>
      </div>`,
    })
  } catch (err) {
    console.error('[appointments] internal alert email failed', err)
  }
}

async function enqueueLawmaticsAfterCommit(appointmentId: string, actorId?: string | null) {
  try {
    const { enqueueLawmaticsAppointmentSync } = await import('@/lib/integrations/lawmatics/jobs')
    await enqueueLawmaticsAppointmentSync(appointmentId, actorId)
  } catch {
    // Reconciliation repairs missed jobs; provider detail must never enter logs.
    console.error('[appointments] lawmatics enqueue failed', appointmentId, 'enqueue_failed')
  }
}

/**
 * Book an appointment: verify the slot against fresh busy data, insert the
 * row (the exclusion constraint is the final race guard), create the calendar
 * event, link lead/matter, and send confirmations.
 */
export async function bookAppointment(rawInput: BookAppointmentInput): Promise<BookAppointmentResult> {
  const input = { ...rawInput, ...normalizeBookingNames({
    firstName: rawInput.attendeeFirstName,
    lastName: rawInput.attendeeLastName,
    secondAttendeeFirstName: rawInput.secondAttendeeFirstName,
    secondAttendeeLastName: rawInput.secondAttendeeLastName,
    secondAttendeeEmail: rawInput.secondAttendeeEmail,
  }) }
  const admin = getAdminClient()
  const settings = await getSchedulingSettings()

  if (settings.bookingPaused && input.source !== 'admin') {
    throw new BookingPausedError()
  }

  const start = Date.parse(input.startIso)
  if (!Number.isFinite(start)) throw new Error('Invalid start time')
  const startIso = new Date(start).toISOString()
  const endIso = new Date(start + input.type.durationMinutes * 60_000).toISOString()

  // Re-verify against fresh calendar + appointment busy data. Throws
  // AvailabilityUnavailableError when the calendar can't be reached (fail closed).
  const busy: Interval[] = await fetchAllBusy(
    new Date(start - DAY_MS),
    new Date(start + DAY_MS),
  )
  if (input.source === 'admin') {
    // Staff bookings bypass client-facing rules (weekly hours, notice,
    // horizon, buffer, slot grid) — only hard conflicts block them.
    const end = start + input.type.durationMinutes * 60_000
    if (busy.some(b => start < b.end && end > b.start)) throw new SlotTakenError()
  } else {
    const available = isSlotAvailable(startIso, {
      weeklyHours: effectiveWeeklyHours(settings.weeklyHours, input.type),
      timezone: settings.timezone,
      durationMinutes: input.type.durationMinutes,
      bufferMinutes: settings.bufferMinutes,
      minNoticeHours: settings.minNoticeHours,
      horizonDays: settings.horizonDays,
      busy,
      now: new Date(),
      dateOverrides: settings.dateOverrides,
    })
    if (!available) throw new SlotTakenError()
  }

  // The chosen meeting format, constrained to the type's allowed list; the
  // rest of the flow (calendar event, emails) sees it as the type's format.
  const locationType = resolveLocationType(input.locationType, input.type)
  const effectiveType: AppointmentType = { ...input.type, locationType }

  const manage = createManageToken()

  const { data: inserted, error: insertError } = await admin
    .from('appointments')
    .insert({
      appointment_type_id: input.type.id,
      start_time: startIso,
      end_time: endIso,
      status: 'scheduled',
      attendee_name: input.attendeeName,
      attendee_first_name: input.attendeeFirstName,
      attendee_last_name: input.attendeeLastName,
      attendee_email: input.attendeeEmail,
      attendee_phone: input.attendeePhone ?? null,
      notes: input.notes ?? null,
      // Only sent when there are answers: a type has no questions to answer
      // until the column exists, so this never races the migration.
      ...(input.bookingAnswers?.length ? { booking_answers: input.bookingAnswers } : {}),
      location_type: locationType,
      second_attendee_name: input.secondAttendeeName?.trim() || null,
      second_attendee_first_name: input.secondAttendeeFirstName,
      second_attendee_last_name: input.secondAttendeeLastName,
      second_attendee_email: input.secondAttendeeEmail?.trim().toLowerCase() || null,
      booked_by_user_id: input.bookedByUserId ?? null,
      manage_token_hash: manage.tokenHash,
      manage_token_expires_at: manage.expiresAt,
      source: input.source,
    })
    .select('id')
    .single()

  if (insertError) {
    if (isOverlapViolation(insertError)) throw new SlotTakenError()
    throw insertError
  }
  const appointmentId = (inserted as { id: string }).id

  // Link lead/matter (reuses the Cal.com matching helpers).
  let leadId: string | null = null
  let matterId: string | null = null
  try {
    const lead = await findLeadByEmail(admin, input.attendeeEmail)
    leadId = lead?.id ?? null
    if (!leadId && input.source === 'public' && input.type.key === 'discovery_call') {
      const created = await createLeadFromAppointment({
        admin,
        attendeeName: input.attendeeName,
        attendeeFirstName: input.attendeeFirstName,
        attendeeLastName: input.attendeeLastName,
        attendeeEmail: input.attendeeEmail,
        attendeePhone: input.attendeePhone ?? null,
        typeLabel: input.type.label,
        startIso,
      })
      leadId = created?.id ?? null
    }
  } catch (err) {
    console.error('[appointments] lead match failed', err)
  }
  try {
    matterId = await findMatterIdByEmail(admin, input.attendeeEmail)
  } catch (err) {
    console.error('[appointments] matter match failed', err)
  }
  if (leadId || matterId) {
    await admin
      .from('appointments')
      .update({ linked_lead_id: leadId, linked_matter_id: matterId })
      .eq('id', appointmentId)
  }

  // Create the Google Calendar event. Failure keeps the booking, flagged in
  // admin by the event id being null.
  const firm = await loadFirmSettings()
  const office = firmOfficeAddress(firm)
  // A Teams meeting is created before the event so its link can go on the
  // invite in place of Meet. If Microsoft refuses, the booking still gets a
  // Meet link rather than no way to join, and the caller is told.
  let teams: { id: string; joinUrl: string } | null = null
  let teamsMeetingError: string | undefined
  if (locationType === 'teams' && input.videoProvider === 'microsoft_teams') {
    try {
      teams = await createAppointmentTeamsMeeting({
        typeLabel: input.type.label,
        attendeeName: input.attendeeName,
        startIso,
        endIso,
      })
      await admin
        .from('appointments')
        .update({
          online_meeting_url: teams.joinUrl,
          online_meeting_provider: 'microsoft_teams',
          teams_meeting_id: teams.id,
        })
        .eq('id', appointmentId)
    } catch (err) {
      teamsMeetingError = err instanceof Error ? err.message : 'Teams meeting could not be created'
      console.error('[appointments] Teams meeting create failed for', appointmentId, err)
    }
  }

  let meetingUrl: string | null = teams?.joinUrl ?? null
  let meetingProvider: OnlineMeetingProvider | null = teams ? 'microsoft_teams' : null
  try {
    const event = await createAppointmentEvent({
      type: effectiveType,
      startIso,
      endIso,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      attendeePhone: input.attendeePhone,
      secondAttendeeName: input.secondAttendeeName,
      secondAttendeeEmail: input.secondAttendeeEmail,
      notes: input.notes,
      bookingAnswers: input.bookingAnswers,
      officeAddress: office || null,
      teamsJoinUrl: teams?.joinUrl ?? null,
    })
    if (event) {
      meetingUrl = event.onlineMeetingUrl
      if (!teams && meetingUrl) meetingProvider = 'google_meet'
      // The id is stored so a later cancel or reschedule can find its way back
      // to the same event.
      await admin
        .from('appointments')
        .update({
          google_event_id: event.eventId,
          online_meeting_url: meetingUrl,
          online_meeting_provider: meetingProvider,
        })
        .eq('id', appointmentId)
    }
  } catch (err) {
    console.error('[appointments] calendar event create failed for', appointmentId, err)
  }

  await recordActivity({
    admin,
    action: 'Booked',
    type: input.type,
    startIso,
    leadId,
    matterId,
    appointmentId,
    bookingAnswers: input.bookingAnswers,
    notes: input.notes,
  })

  await sendConfirmationEmails({
    appointmentId,
    type: effectiveType,
    startIso,
    attendeeName: input.attendeeName,
    attendeeEmail: input.attendeeEmail,
    ccEmail: input.secondAttendeeEmail?.trim().toLowerCase() || null,
    manageToken: manage.token,
    meetingUrl,
    meetingProvider,
    timezone: settings.timezone,
    action: 'Booked',
    skipInternalAlert: input.source === 'admin',
    bookingAnswers: input.bookingAnswers,
    notes: input.notes,
    leadId,
    matterId,
    actorId: input.source === 'admin' ? input.bookedByUserId ?? null : null,
  })

  await runPostBookingAutomation({
    type: input.type,
    leadId,
    matterId,
    autoIntakeInvite: settings.autoIntakeInvite,
    startIso,
    bookedByUserId: input.source === 'admin' ? input.bookedByUserId ?? null : null,
  })

  // The queue's optional actor is staff-only; portal attribution stays on the booking.
  await enqueueLawmaticsAfterCommit(appointmentId, input.source === 'admin' ? input.bookedByUserId : null)
  // Statular clients are created when the lead is marked a fit, not at booking:
  // see enqueueStatularClientForFitMatter (sla-anchors PATCH).
  return {
    appointmentId,
    startIso,
    endIso,
    manageToken: manage.token,
    ...(teamsMeetingError ? { teamsMeetingError } : {}),
  }
}

export interface CancelAppointmentInput {
  appointment: AppointmentRow
  type: AppointmentType
  /** Staff cancelled from the admin calendar: notify the client, not the firm. */
  cancelledByStaff?: boolean
}

export async function cancelAppointment(input: CancelAppointmentInput): Promise<void> {
  const admin = getAdminClient()
  const { appointment, type } = input

  const { error } = await admin
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointment.id)
    .eq('status', 'scheduled')
  if (error) throw error

  await enqueueLawmaticsAfterCommit(appointment.id)

  try {
    await cancelAppointmentEvent(appointment)
  } catch (err) {
    console.error('[appointments] calendar cancel failed for', appointment.id, err)
  }
  await cancelAppointmentTeamsMeeting(appointment)

  await recordActivity({
    admin,
    action: 'Cancelled',
    type,
    startIso: null,
    leadId: appointment.linked_lead_id,
    matterId: appointment.linked_matter_id,
    appointmentId: appointment.id,
  })

  try {
    const settings = await getSchedulingSettings()
    const when = formatWhen(appointment.start_time, settings.timezone)
    if (input.cancelledByStaff) {
      // Google also emails an event cancellation; this adds the human note.
      await sendEmail({
        category: 'appointment_confirmation',
        to: appointment.attendee_email,
        cc: appointment.second_attendee_email ?? undefined,
        subject: `Appointment cancelled: ${type.label} — ${when}`,
        html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
          <h2 style="margin:0 0 12px">Your appointment was cancelled</h2>
          <p>${type.label} — ${when}</p>
          <p>If this is unexpected or you'd like to rebook, just reply to this
          email and we will find a new time.</p>
        </div>`,
      })
    } else {
      await sendEmail({
        category: 'appointment_booked_alert',
        to: ADMIN_EMAIL,
        replyTo: appointment.attendee_email,
        subject: `Cancelled: ${type.label} — ${appointment.attendee_name}`,
        html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
          <p><strong>${appointment.attendee_name}</strong> (${appointment.attendee_email}) cancelled
          their ${type.label} on ${when}.</p>
        </div>`,
      })
    }
  } catch (err) {
    console.error('[appointments] cancel email failed', err)
  }
}

export interface MarkNoShowInput {
  appointment: AppointmentRow
  type: AppointmentType
  /** Send the client a "sorry we missed you" email with a rebook link. */
  sendFollowUp: boolean
}

/**
 * Mark a past appointment as a no-show. Leaves the calendar event alone (it
 * already happened) and optionally emails the client a rebook nudge.
 */
export async function markNoShow(input: MarkNoShowInput): Promise<void> {
  const admin = getAdminClient()
  const { appointment, type } = input

  const { data, error } = await admin
    .from('appointments')
    .update({ status: 'no_show' })
    .eq('id', appointment.id)
    .eq('status', 'scheduled')
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Appointment is not in a scheduled state')

  await recordActivity({
    admin,
    action: 'No-show',
    type,
    startIso: appointment.start_time,
    leadId: appointment.linked_lead_id,
    matterId: appointment.linked_matter_id,
    appointmentId: appointment.id,
  })

  if (!input.sendFollowUp || !appointment.attendee_email) return

  try {
    const settings = await getSchedulingSettings()
    await sendEmail({
      category: 'appointment_missed_followup',
      to: appointment.attendee_email,
      cc: appointment.second_attendee_email ?? undefined,
      subject: `Sorry we missed you — ${type.label}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Sorry we missed you</h2>
        <p>We had a ${type.label} scheduled for
        ${formatWhen(appointment.start_time, settings.timezone)}, but weren't able
        to connect.</p>
        <p><a href="${portalUrl(`/book/${type.slug}`)}" style="color:#1a6b72">Pick a new time</a>
        — or just reply to this email and we will get you rescheduled.</p>
      </div>`,
    })
  } catch (err) {
    console.error('[appointments] no-show follow-up email failed', err)
  }
}

export interface RescheduleAppointmentInput {
  appointment: AppointmentRow
  type: AppointmentType
  newStartIso: string
  /** Staff reschedule: bypass client-facing rules, hard conflicts only. */
  adminOverride?: boolean
}

export async function rescheduleAppointment(
  input: RescheduleAppointmentInput,
): Promise<{ startIso: string; endIso: string }> {
  const admin = getAdminClient()
  const { appointment, type } = input
  const settings = await getSchedulingSettings()

  const start = Date.parse(input.newStartIso)
  if (!Number.isFinite(start)) throw new Error('Invalid start time')
  const startIso = new Date(start).toISOString()
  const endIso = new Date(start + type.durationMinutes * 60_000).toISOString()

  const busy = (
    await fetchAllBusy(new Date(start - DAY_MS), new Date(start + DAY_MS))
  ).filter(
    // The slot being moved must not block its own reschedule.
    iv =>
      !(
        iv.start === Date.parse(appointment.start_time) &&
        iv.end === Date.parse(appointment.end_time)
      ),
  )
  if (input.adminOverride) {
    const end = start + type.durationMinutes * 60_000
    if (busy.some(b => start < b.end && end > b.start)) throw new SlotTakenError()
  } else {
    const available = isSlotAvailable(startIso, {
      weeklyHours: effectiveWeeklyHours(settings.weeklyHours, type),
      timezone: settings.timezone,
      durationMinutes: type.durationMinutes,
      bufferMinutes: settings.bufferMinutes,
      minNoticeHours: settings.minNoticeHours,
      horizonDays: settings.horizonDays,
      busy,
      now: new Date(),
      dateOverrides: settings.dateOverrides,
    })
    if (!available) throw new SlotTakenError()
  }

  const { error } = await admin
    .from('appointments')
    // reminder_sent_at resets so the moved time gets its own reminder.
    .update({ start_time: startIso, end_time: endIso, reminder_sent_at: null })
    .eq('id', appointment.id)
    .eq('status', 'scheduled')
  if (error) {
    if (isOverlapViolation(error)) throw new SlotTakenError()
    throw error
  }

  await enqueueLawmaticsAfterCommit(appointment.id)

  try {
    await rescheduleAppointmentEvent(appointment, startIso, endIso)
  } catch (err) {
    console.error('[appointments] calendar reschedule failed for', appointment.id, err)
  }
  await rescheduleAppointmentTeamsMeeting(appointment, startIso, endIso)

  await recordActivity({
    admin,
    action: 'Rescheduled',
    type,
    startIso,
    leadId: appointment.linked_lead_id,
    matterId: appointment.linked_matter_id,
    appointmentId: appointment.id,
  })

  await sendConfirmationEmails({
    appointmentId: appointment.id,
    // Honor the format chosen at booking time (stored on the row).
    type: { ...type, locationType: resolveLocationType(appointment.location_type, type) },
    startIso,
    attendeeName: appointment.attendee_name,
    attendeeEmail: appointment.attendee_email,
    ccEmail: appointment.second_attendee_email ?? null,
    // Manage link keeps working — token is unchanged on reschedule.
    manageToken: null,
    meetingUrl: appointment.online_meeting_url,
    meetingProvider: appointment.online_meeting_provider ?? null,
    timezone: settings.timezone,
    action: 'Rescheduled',
    leadId: appointment.linked_lead_id,
    matterId: appointment.linked_matter_id,
  })

  return { startIso, endIso }
}
