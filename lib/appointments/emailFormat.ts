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

/** Location sentence for confirmation/reminder emails, by meeting format. */
export function locationLine(
  type: AppointmentType,
  officeAddress: string | null,
  teamsUrl: string | null,
): string {
  switch (type.locationType) {
    case 'teams':
      return teamsUrl
        ? `Microsoft Teams — <a href="${teamsUrl}" style="color:#1a6b72">Join the meeting</a>`
        : 'Microsoft Teams (join link is in your calendar invite)'
    case 'in_person':
      return officeAddress ? `In person at ${officeAddress}` : 'In person at our office'
    default:
      return 'Phone call — we will call the number you provided'
  }
}
