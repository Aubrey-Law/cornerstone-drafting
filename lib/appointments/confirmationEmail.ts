import { portalUrl } from '@/lib/urls'
import type { OnlineMeetingProvider } from './calendarTypes'
import { formatWhen, locationLine } from './emailFormat'
import type { AppointmentType } from './types'
import { firmOfficeAddress } from './officeAddress'

/**
 * The client-facing confirmation, built the same way whether it is sent from
 * the booking call or by the delegation dial's `appointment.confirmation.send`
 * action later. One builder, so the preview a person approves is the email
 * the client receives.
 */

export type ConfirmationEvent = 'booked' | 'rescheduled'

export interface ConfirmationEmailInput {
  type: Pick<AppointmentType, 'label' | 'locationType'>
  startIso: string
  timezone: string
  officeAddress: string | null
  meetingUrl: string | null
  meetingProvider: OnlineMeetingProvider | null
  /** The raw manage-link token; null leaves the reschedule/cancel link out. */
  manageToken: string | null
  event: ConfirmationEvent
}

export function buildAppointmentConfirmationEmail(input: ConfirmationEmailInput): { subject: string; html: string; when: string } {
  const when = formatWhen(input.startIso, input.timezone)
  const verb = input.event === 'rescheduled' ? 'rescheduled' : 'confirmed'
  const manageHtml = input.manageToken
    ? `<p style="margin-top:16px">Need to make a change?
        <a href="${portalUrl(`/book/manage/${input.manageToken}`)}" style="color:#1a6b72">Reschedule or cancel</a></p>`
    : ''
  return {
    when,
    subject: `Appointment ${verb}: ${input.type.label} — ${when}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Your appointment is ${verb}</h2>
        <p><strong>${input.type.label}</strong></p>
        <p>${when}</p>
        <p>${locationLine(input.type as AppointmentType, input.officeAddress, input.meetingUrl, input.meetingProvider)}</p>
        <p>A calendar invitation is on its way to your inbox.</p>
        ${manageHtml}
      </div>`,
  }
}

/** Office line for the location sentence, from firm settings. */
export function officeAddressLine(firm: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string | null {
  // One office address for every surface; see lib/appointments/officeAddress.ts.
  return firmOfficeAddress(firm)
}
