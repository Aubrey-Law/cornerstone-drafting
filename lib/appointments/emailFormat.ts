import type { OnlineMeetingProvider } from './calendarTypes'
import type { AppointmentType } from './types'

/** Human-readable start time in the firm timezone for email bodies. */
export function formatWhen(iso: string, timezone = 'America/New_York'): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Location sentence for confirmation/reminder emails, by meeting format.
 *
 * A Teams meeting wins over the format: staff can add one to any appointment,
 * and once they have, the Teams link is where the meeting happens.
 */
export function locationLine(
  type: AppointmentType,
  officeAddress: string | null,
  meetingUrl: string | null,
  meetingProvider: OnlineMeetingProvider | null = null,
): string {
  if (meetingProvider === 'microsoft_teams' && meetingUrl) {
    return `Microsoft Teams — <a href="${meetingUrl}" style="color:#1a6b72">Join the meeting</a>`
  }
  switch (type.locationType) {
    case 'teams':
      return meetingUrl
        ? `Google Meet — <a href="${meetingUrl}" style="color:#1a6b72">Join the meeting</a>`
        : 'Video call — meeting link will be provided in your calendar invite'
    case 'in_person':
      return officeAddress ? `In person at ${officeAddress}` : 'In person at our office'
    default:
      return 'Phone call — we will call the number you provided'
  }
}
