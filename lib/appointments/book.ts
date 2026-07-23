import 'server-only'
import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { findLeadByEmail, findMatterIdByEmail } from '@/lib/calcom/link'
import { sendEmail } from '@/lib/email/send'
import { loadFirmSettings } from '@/lib/firmSettings'
import { portalUrl, appUrl } from '@/lib/urls'
import { isSlotAvailable } from './availability'
import { fetchAllBusy, AvailabilityUnavailableError } from './graphBusy'
import {
  cancelCalendarEvent,
  createCalendarEvent,
  rescheduleCalendarEvent,
} from './graphEvents'
import { formatWhen, locationLine } from './emailFormat'
import { createManageToken } from './manageTokens'
import { getSchedulingSettings } from './settings'
import {
  effectiveWeeklyHours,
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

export interface BookAppointmentInput {
  type: AppointmentType
  startIso: string
  attendeeName: string
  attendeeEmail: string
  attendeePhone?: string | null
  notes?: string | null
  source: AppointmentSource
  bookedByUserId?: string | null
}

export interface BookAppointmentResult {
  appointmentId: string
  startIso: string
  endIso: string
  manageToken: string
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
  attendeeEmail: string
  attendeePhone: string | null
  typeLabel: string
  startIso: string
}): Promise<LeadRow | null> {
  const { admin, attendeeName, attendeeEmail, attendeePhone, typeLabel, startIso } = input
  const parts = attendeeName.trim().split(/\s+/)
  const firstName = parts[0] || 'Unknown'
  const lastName = parts.slice(1).join(' ') || 'Unknown'

  const { data, error } = await admin
    .from('client_intake')
    .insert({
      first_name: firstName,
      last_name: lastName,
      full_name: attendeeName.trim() || `${firstName} ${lastName}`.trim(),
      email: attendeeEmail,
      phone: attendeePhone,
      status: 'in_progress',
      lead_status: 'lead',
      lead_source: 'scheduler',
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

  return lead
}

async function recordActivity(input: {
  admin: AdminClient
  action: 'Booked' | 'Rescheduled' | 'Cancelled'
  type: AppointmentType
  startIso: string | null
  leadId: string | null
  matterId: string | null
  appointmentId: string
}): Promise<void> {
  const { admin, action, type, startIso, leadId, matterId, appointmentId } = input
  const when = startIso ? ` — ${formatWhen(startIso)}` : ''

  if (leadId) {
    try {
      await admin.from('lead_activity').insert({
        lead_id: leadId,
        event_type: action === 'Cancelled' ? 'note' : 'consult_scheduled',
        title: `${action}: ${type.label}`,
        detail: `${action} through the scheduling page${when}`,
        actor_id: null,
      })
    } catch (err) {
      console.error('[appointments] lead activity failed', err)
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
        body: `${body} (appointment ${appointmentId})`,
        author: 'System',
      })

      // Mirror the Cal.com sync: key dates land on matter_details.
      if (action !== 'Cancelled' && startIso) {
        const dateOnly = new Date(startIso).toISOString().split('T')[0]
        if (type.key === 'signing_appointment') {
          await admin
            .from('matter_details')
            .upsert({ client_id: matterId, scheduled_signing_date: dateOnly }, { onConflict: 'client_id' })
        } else if (type.key === 'pmps') {
          await admin
            .from('matter_details')
            .upsert({ client_id: matterId, design_meeting_date: dateOnly }, { onConflict: 'client_id' })
        }
      }
    } catch (err) {
      console.error('[appointments] matter note failed', err)
    }
  }
}


async function sendConfirmationEmails(input: {
  type: AppointmentType
  startIso: string
  attendeeName: string
  attendeeEmail: string
  manageToken: string | null
  teamsUrl: string | null
  timezone: string
  action: 'Booked' | 'Rescheduled'
  /** Staff booked it themselves — no point alerting them about it. */
  skipInternalAlert?: boolean
}): Promise<void> {
  const firm = await loadFirmSettings()
  const office = [firm.street, [firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(', ')
  const when = formatWhen(input.startIso, input.timezone)
  const manageHtml = input.manageToken
    ? `<p style="margin-top:16px">Need to make a change?
        <a href="${portalUrl(`/book/manage/${input.manageToken}`)}" style="color:#1a6b72">Reschedule or cancel</a></p>`
    : ''
  const verb = input.action === 'Rescheduled' ? 'rescheduled' : 'confirmed'

  try {
    await sendEmail({
      category: 'appointment_confirmation',
      to: input.attendeeEmail,
      subject: `Appointment ${verb}: ${input.type.label} — ${when}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Your appointment is ${verb}</h2>
        <p><strong>${input.type.label}</strong></p>
        <p>${when}</p>
        <p>${locationLine(input.type, office || null, input.teamsUrl)}</p>
        <p>A calendar invitation from Outlook is on its way to your inbox.</p>
        ${manageHtml}
      </div>`,
    })
  } catch (err) {
    console.error('[appointments] confirmation email failed', err)
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
        <p><a href="${appUrl('/admin/settings?tab=scheduling')}" style="color:#1a6b72">View appointments →</a></p>
      </div>`,
    })
  } catch (err) {
    console.error('[appointments] internal alert email failed', err)
  }
}

/**
 * Book an appointment: verify the slot against fresh busy data, insert the
 * row (the exclusion constraint is the final race guard), create the Outlook
 * event, link lead/matter, and send confirmations.
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const admin = getAdminClient()
  const settings = await getSchedulingSettings()

  const start = Date.parse(input.startIso)
  if (!Number.isFinite(start)) throw new Error('Invalid start time')
  const startIso = new Date(start).toISOString()
  const endIso = new Date(start + input.type.durationMinutes * 60_000).toISOString()

  // Re-verify against fresh Outlook + appointment busy data. Throws
  // AvailabilityUnavailableError when Outlook can't be reached (fail closed).
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
    })
    if (!available) throw new SlotTakenError()
  }

  const manage = createManageToken()

  const { data: inserted, error: insertError } = await admin
    .from('appointments')
    .insert({
      appointment_type_id: input.type.id,
      start_time: startIso,
      end_time: endIso,
      status: 'scheduled',
      attendee_name: input.attendeeName,
      attendee_email: input.attendeeEmail,
      attendee_phone: input.attendeePhone ?? null,
      notes: input.notes ?? null,
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

  // Create the Outlook event. Failure keeps the booking (flagged in admin by
  // microsoft_event_id being null).
  const firm = await loadFirmSettings()
  const office = [firm.street, [firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(', ')
  let teamsUrl: string | null = null
  try {
    const event = await createCalendarEvent({
      type: input.type,
      startIso,
      endIso,
      attendeeName: input.attendeeName,
      attendeeEmail: input.attendeeEmail,
      attendeePhone: input.attendeePhone,
      notes: input.notes,
      officeAddress: office || null,
    })
    teamsUrl = event.onlineMeetingUrl
    await admin
      .from('appointments')
      .update({ microsoft_event_id: event.eventId, online_meeting_url: teamsUrl })
      .eq('id', appointmentId)
  } catch (err) {
    console.error('[appointments] graph event create failed for', appointmentId, err)
  }

  await recordActivity({
    admin,
    action: 'Booked',
    type: input.type,
    startIso,
    leadId,
    matterId,
    appointmentId,
  })

  await sendConfirmationEmails({
    type: input.type,
    startIso,
    attendeeName: input.attendeeName,
    attendeeEmail: input.attendeeEmail,
    manageToken: manage.token,
    teamsUrl,
    timezone: settings.timezone,
    action: 'Booked',
    skipInternalAlert: input.source === 'admin',
  })

  return { appointmentId, startIso, endIso, manageToken: manage.token }
}

export interface CancelAppointmentInput {
  appointment: AppointmentRow
  type: AppointmentType
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

  if (appointment.microsoft_event_id) {
    try {
      await cancelCalendarEvent(appointment.microsoft_event_id)
    } catch (err) {
      console.error('[appointments] graph cancel failed for', appointment.id, err)
    }
  }

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
    await sendEmail({
      category: 'appointment_booked_alert',
      to: ADMIN_EMAIL,
      replyTo: appointment.attendee_email,
      subject: `Cancelled: ${type.label} — ${appointment.attendee_name}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <p><strong>${appointment.attendee_name}</strong> (${appointment.attendee_email}) cancelled
        their ${type.label} on ${formatWhen(appointment.start_time, settings.timezone)}.</p>
      </div>`,
    })
  } catch (err) {
    console.error('[appointments] cancel alert email failed', err)
  }
}

export interface RescheduleAppointmentInput {
  appointment: AppointmentRow
  type: AppointmentType
  newStartIso: string
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
  const available = isSlotAvailable(startIso, {
    weeklyHours: effectiveWeeklyHours(settings.weeklyHours, type),
    timezone: settings.timezone,
    durationMinutes: type.durationMinutes,
    bufferMinutes: settings.bufferMinutes,
    minNoticeHours: settings.minNoticeHours,
    horizonDays: settings.horizonDays,
    busy,
    now: new Date(),
  })
  if (!available) throw new SlotTakenError()

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

  if (appointment.microsoft_event_id) {
    try {
      await rescheduleCalendarEvent(appointment.microsoft_event_id, startIso, endIso)
    } catch (err) {
      console.error('[appointments] graph reschedule failed for', appointment.id, err)
    }
  }

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
    type,
    startIso,
    attendeeName: appointment.attendee_name,
    attendeeEmail: appointment.attendee_email,
    // Manage link keeps working — token is unchanged on reschedule.
    manageToken: null,
    teamsUrl: null,
    timezone: settings.timezone,
    action: 'Rescheduled',
  })

  return { startIso, endIso }
}
