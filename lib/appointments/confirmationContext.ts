import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFirmSettings } from '@/lib/firmSettings'
import { attendeeFirstName, officeAddressLine, type ConfirmationEmailInput } from './confirmationEmail'
import { getSchedulingSettings, listAppointmentTypes } from './settings'
import type { AppointmentRow, AppointmentType } from './types'
import { resolveLocationType } from './types'

/**
 * Everything the confirmation action needs to rebuild the client email from
 * the appointment row, read fresh at preview and again at execution so a
 * held confirmation describes the appointment as it stands.
 */
export async function loadConfirmationContext(admin: SupabaseClient, appointmentId: string): Promise<{
  appointment: Pick<AppointmentRow,
    'id' | 'appointment_type_id' | 'start_time' | 'status' | 'location_type' | 'attendee_name' | 'attendee_first_name' | 'attendee_email'
    | 'second_attendee_email' | 'linked_lead_id' | 'linked_matter_id' | 'online_meeting_url' | 'online_meeting_provider'>
  type: AppointmentType
  email: Omit<ConfirmationEmailInput, 'manageToken' | 'event'>
}> {
  const { data, error } = await admin.from('appointments')
    .select('id, appointment_type_id, start_time, status, location_type, attendee_name, attendee_first_name, attendee_email, second_attendee_email, linked_lead_id, linked_matter_id, online_meeting_url, online_meeting_provider')
    .eq('id', appointmentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Appointment not found')
  const appointment = data as unknown as Awaited<ReturnType<typeof loadConfirmationContext>>['appointment']
  const baseType = (await listAppointmentTypes()).find(type => type.id === appointment.appointment_type_id)
  if (!baseType) throw new Error('Appointment type not found')
  const type: AppointmentType = { ...baseType, locationType: resolveLocationType(appointment.location_type, baseType) }
  const [settings, firm] = await Promise.all([getSchedulingSettings(), loadFirmSettings()])
  return {
    appointment,
    type,
    email: {
      type,
      startIso: appointment.start_time,
      timezone: settings.timezone,
      officeAddress: officeAddressLine(firm),
      meetingUrl: appointment.online_meeting_url,
      meetingProvider: appointment.online_meeting_provider ?? null,
      firstName: appointment.attendee_first_name?.trim() || attendeeFirstName(appointment.attendee_name),
    },
  }
}
