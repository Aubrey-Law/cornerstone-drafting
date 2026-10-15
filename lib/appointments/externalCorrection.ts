import 'server-only'

import { recordDiscoveryAnchor } from '@/lib/bookings/discoveryAnchor'
import { recordPmpsAnchor } from '@/lib/bookings/pmpsAnchor'
import { cancelAppointmentEvent, rescheduleAppointmentEvent } from '@/lib/appointments/calendarSync'
import { formatWhen } from '@/lib/appointments/emailFormat'
import {
  cancelAppointmentTeamsMeeting,
  rescheduleAppointmentTeamsMeeting,
} from '@/lib/appointments/teamsMeeting'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  externalSourceLabel,
  isExternallyManagedSource,
  type AppointmentRow,
  type AppointmentType,
} from '@/lib/appointments/types'

/**
 * Record a cancellation or a new time for a meeting that was booked in
 * Lawmatics, Calendly, or Cal.com.
 *
 * Those rows are mirrors. Changing one here does not email the client and
 * does not write back to the outside scheduler — that scheduler already owns
 * the invite. The matching external_bookings row is updated too, so a later
 * import leaves the meeting alone when it agrees and restores the outside
 * time when it does not.
 */
export class ExternalAppointmentStateError extends Error {
  constructor(message = 'Only a scheduled meeting can be removed or rescheduled') {
    super(message)
    this.name = 'ExternalAppointmentStateError'
  }
}

export async function correctExternalAppointment(input: {
  appointment: AppointmentRow
  type: AppointmentType
  action: 'cancel' | 'reschedule'
  newStartIso?: string
  actorId?: string | null
}): Promise<{ startIso: string; endIso: string }> {
  const { appointment, type } = input
  if (!isExternallyManagedSource(appointment.source)) {
    throw new ExternalAppointmentStateError('This meeting was booked in Cornerstone')
  }
  const label = externalSourceLabel(appointment.source) ?? 'the outside scheduler'
  const admin = getAdminClient()

  if (input.action === 'cancel') {
    const changed = await claim(admin, appointment.id, { status: 'cancelled' })
    if (!changed && !(await alreadyCancelled(admin, appointment.id))) {
      throw new ExternalAppointmentStateError('Only a scheduled meeting can be removed')
    }
    await syncBooking(admin, appointment, { status: 'cancelled' })
    if (changed) {
      await releaseCalendar(appointment)
      await recordChange({
        admin,
        action: 'Cancelled',
        type,
        startIso: null,
        appointment,
        label,
        actorId: input.actorId ?? null,
      })
    }
    return { startIso: appointment.start_time, endIso: appointment.end_time }
  }

  const start = Date.parse(input.newStartIso ?? '')
  if (!Number.isFinite(start)) throw new ExternalAppointmentStateError('A new start time is required')
  const startIso = new Date(start).toISOString()
  const duration = Date.parse(appointment.end_time) - Date.parse(appointment.start_time)
  const length = Number.isFinite(duration) && duration > 0 ? duration : type.durationMinutes * 60_000
  const endIso = new Date(start + length).toISOString()

  if (
    appointment.status === 'scheduled'
    && sameInstant(appointment.start_time, startIso)
    && sameInstant(appointment.end_time, endIso)
  ) {
    await syncBooking(admin, appointment, { status: 'rescheduled', start_time: startIso, end_time: endIso })
    return { startIso, endIso }
  }

  const changed = await claim(admin, appointment.id, {
    start_time: startIso,
    end_time: endIso,
    reminder_sent_at: null,
  })
  if (!changed && !(await alreadyMoved(admin, appointment.id, startIso, endIso))) {
    throw new ExternalAppointmentStateError('Only a scheduled meeting can be rescheduled')
  }
  await syncBooking(admin, appointment, { status: 'rescheduled', start_time: startIso, end_time: endIso })
  if (changed) {
    try {
      await rescheduleAppointmentEvent(appointment, startIso, endIso)
    } catch (err) {
      console.error('[appointments] calendar reschedule failed for', appointment.id, err)
    }
    await rescheduleAppointmentTeamsMeeting(appointment, startIso, endIso)
    await recordChange({
      admin,
      action: 'Rescheduled',
      type,
      startIso,
      appointment,
      label,
      actorId: input.actorId ?? null,
    })
  }
  return { startIso, endIso }
}

type Admin = ReturnType<typeof getAdminClient>

async function claim(admin: Admin, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin
    .from('appointments')
    .update(patch)
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
  if (error) throw error
  return Boolean(data?.length)
}

async function alreadyCancelled(admin: Admin, id: string): Promise<boolean> {
  const { data, error } = await admin.from('appointments').select('status').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as { status?: string } | null)?.status === 'cancelled'
}

async function alreadyMoved(admin: Admin, id: string, startIso: string, endIso: string): Promise<boolean> {
  const { data, error } = await admin
    .from('appointments')
    .select('status, start_time, end_time')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  const row = data as { status?: string; start_time?: string; end_time?: string } | null
  return row?.status === 'scheduled'
    && sameInstant(row.start_time ?? null, startIso)
    && sameInstant(row.end_time ?? null, endIso)
}

async function syncBooking(
  admin: Admin,
  appointment: AppointmentRow,
  patch: { status: 'cancelled' | 'rescheduled'; start_time?: string; end_time?: string },
): Promise<void> {
  if (!appointment.external_booking_uid) return
  const { error } = await admin
    .from('external_bookings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('provider', appointment.source)
    .eq('booking_uid', appointment.external_booking_uid)
  if (error) throw error
}

async function releaseCalendar(appointment: AppointmentRow): Promise<void> {
  try {
    await cancelAppointmentEvent(appointment)
  } catch (err) {
    console.error('[appointments] calendar cancel failed for', appointment.id, err)
  }
  await cancelAppointmentTeamsMeeting(appointment)
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  return Date.parse(a) === Date.parse(b)
}

async function recordChange(input: {
  admin: Admin
  action: 'Cancelled' | 'Rescheduled'
  type: AppointmentType
  startIso: string | null
  appointment: AppointmentRow
  label: string
  actorId: string | null
}): Promise<void> {
  const { admin, action, type, startIso, appointment, label, actorId } = input
  const when = startIso ? ` — ${formatWhen(startIso)}` : ''
  const detail = `Recorded in Cornerstone after the ${label} meeting changed${when}. The client was not emailed from here.`

  if (appointment.linked_lead_id) {
    try {
      await admin.from('lead_activity').insert({
        lead_id: appointment.linked_lead_id,
        event_type: action === 'Cancelled' ? 'note' : 'consult_scheduled',
        title: `${action}: ${type.label}`,
        detail,
        actor_id: actorId,
      })
    } catch (err) {
      console.error('[appointments] lead activity failed', err)
    }
  }

  if (appointment.linked_matter_id) {
    try {
      const body = action === 'Cancelled'
        ? `Appointment removed: ${type.label} (${label})`
        : `Appointment rescheduled: ${type.label} (${label})${when}`
      await admin.from('matter_notes').insert({
        matter_id: appointment.linked_matter_id,
        note_type: 'internal',
        body: `${body}. ${detail}`,
        author: 'Staff',
      })
      if (action === 'Rescheduled' && startIso && type.key === 'signing_appointment') {
        await admin.from('matter_details').upsert(
          { client_id: appointment.linked_matter_id, scheduled_signing_date: new Date(startIso).toISOString() },
          { onConflict: 'client_id' },
        )
      }
    } catch (err) {
      console.error('[appointments] matter note failed', err)
    }
  }

  if (action === 'Rescheduled' && startIso && type.key === 'discovery_call') {
    try {
      await recordDiscoveryAnchor(admin, {
        leadId: appointment.linked_lead_id,
        matterId: appointment.linked_matter_id,
        startIso,
        overwrite: true,
      })
    } catch (err) {
      console.error('[appointments] discovery anchor failed', err)
    }
  }

  if (action === 'Rescheduled' && startIso && type.key === 'pmps') {
    try {
      await recordPmpsAnchor(admin, {
        leadId: appointment.linked_lead_id,
        matterId: appointment.linked_matter_id,
        startIso,
      })
    } catch (err) {
      console.error('[appointments] pmps anchor failed', err)
    }
  }
}
