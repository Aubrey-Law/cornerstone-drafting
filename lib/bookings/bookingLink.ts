import { getCalendlyUrls, buildCalendlyLink, type CalendlyLinkChannel } from '@/lib/calendly/links'
import { getAppointmentTypeByKey } from '@/lib/appointments/settings'
import { meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'
import { portalUrl } from '@/lib/urls'

/**
 * The booking link a client is sent for a meeting type. A configured outside
 * scheduler (Calendly, Cal.com, Lawmatics) wins when Settings names one;
 * otherwise the firm's own booking page for the matching appointment type.
 */
export async function resolveBookingLink(input: {
  meetingTypeKey: string
  name: string | null
  email: string | null
  leadId?: string | null
  matterId?: string | null
  channel: CalendlyLinkChannel
}): Promise<{ url: string; label: string; provider: 'external' | 'native' }> {
  const meetingType = meetingTypeForKey(input.meetingTypeKey)
  if (!meetingType) throw new Error('Unknown meeting type')
  const configured = (await getCalendlyUrls())[meetingType.key as MeetingTypeKey]
  if (configured) {
    return {
      url: buildCalendlyLink(configured, {
        name: input.name,
        email: input.email,
        leadId: input.leadId ?? null,
        matterId: input.matterId ?? null,
        channel: input.channel,
      }),
      label: meetingType.label,
      provider: 'external',
    }
  }
  const type = await getAppointmentTypeByKey(meetingType.key)
  if (!type || !type.active) throw new Error(`No booking page is available for ${meetingType.label}`)
  return { url: portalUrl(`/book/${type.slug}`), label: type.label, provider: 'native' }
}

export function schedulingLinkMessage(firstName: string | null, label: string, link: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,'
  return `${greeting}\n\nPlease use this link to schedule your ${label}:\n${link}\n\nIf none of the times work, let us know and we'll find one that does.`
}

export function schedulingLinkHtml(text: string, link: string): string {
  const escape = (value: string) => value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const escapedLink = escape(link)
  const escaped = escape(text)
  const linked = escaped.includes(escapedLink)
    ? escaped.replace(escapedLink, `<a href="${escapedLink}">${escapedLink}</a>`)
    : escaped
  return `<pre style="font-family:inherit;white-space:pre-wrap">${linked}</pre>`
}
