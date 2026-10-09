import { getAppointmentTypeByKey } from '@/lib/appointments/settings'
import { splitDisplayName } from '@/lib/appointments/types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadBookingAttendee } from '@/lib/appointments/bookingAttendee'
import { nativeBookingUrl, type BookingPrefill } from '@/lib/bookings/prefill'
import { portalUrl } from '@/lib/urls'

/**
 * The firm's own booking page a client is sent for an appointment type, with
 * their details filled in. Outside schedulers named in Settings → Scheduling
 * are no longer used for client links.
 *
 * A portal-only type cannot be booked from a public link: with
 * `portalOnly: 'schedule'` it resolves to the portal's Schedule page (the
 * client signs in first); otherwise it is refused.
 */
export async function resolveBookingLink(input: {
  meetingTypeKey: string
  name: string | null
  email: string | null
  phone?: string | null
  leadId?: string | null
  matterId?: string | null
  portalOnly?: 'refuse' | 'schedule'
}): Promise<{ url: string; label: string; via: 'booking_page' | 'portal' }> {
  const type = await getAppointmentTypeByKey(input.meetingTypeKey)
  if (!type || !type.active) throw new Error(`No booking page is available for ${input.meetingTypeKey}`)
  if (!type.public) {
    if (input.portalOnly === 'schedule') return { url: portalUrl('/schedule'), label: type.label, via: 'portal' }
    throw new Error(`${type.label} is booked from the client portal, so it cannot be sent as a booking link.`)
  }
  return { url: nativeBookingUrl(type.slug, await bookingPrefill(input)), label: type.label, via: 'booking_page' }
}

/** Stored first/last names when a lead or matter is known; the given name split otherwise. */
async function bookingPrefill(input: {
  name: string | null
  email: string | null
  phone?: string | null
  leadId?: string | null
  matterId?: string | null
}): Promise<BookingPrefill> {
  const target = input.leadId ? { leadId: input.leadId } : input.matterId ? { matterId: input.matterId } : null
  const attendee = target ? await loadBookingAttendee(getAdminClient(), target).catch(() => null) : null
  const split = splitDisplayName(input.name)
  return {
    firstName: attendee?.firstName || split.firstName,
    lastName: attendee?.lastName || split.lastName,
    email: input.email || attendee?.email,
    phone: input.phone || attendee?.phone,
  }
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
