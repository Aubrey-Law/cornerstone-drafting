import { getAdminClient } from '@/lib/supabaseAdmin'
import { meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'
import { bookingProviderForUrl, isBookingUrl } from '@/lib/bookings/provider'

export type CalendlyLinkChannel = 'email' | 'sms' | 'portal' | 'staff'

// Despite the name, values may be any https booking page (Calendly, Cal.com,
// Lawmatics, …) — see lib/bookings/provider.ts.
export type CalendlyUrlMap = Partial<Record<MeetingTypeKey, string>>

export function sanitizeCalendlyUrls(value: unknown): CalendlyUrlMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: CalendlyUrlMap = {}
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    const meetingType = meetingTypeForKey(key)
    if (meetingType && isBookingUrl(url)) map[meetingType.key] = url.trim()
  }
  return map
}

export function buildCalendlyLink(
  baseUrl: string,
  opts: {
    name?: string | null
    email?: string | null
    leadId?: string | null
    matterId?: string | null
    channel: CalendlyLinkChannel
  },
): string {
  const url = new URL(baseUrl)
  if (opts.name) url.searchParams.set('name', opts.name)
  if (opts.email) url.searchParams.set('email', opts.email)
  url.searchParams.set('utm_source', 'app')
  url.searchParams.set('utm_medium', opts.channel)
  // matterId wins: matches the webhook's matter-first resolution
  // (lib/bookings/sync.ts) so the booking links to the matter.
  if (opts.matterId) url.searchParams.set('utm_content', `matterId:${opts.matterId}`)
  else if (opts.leadId) url.searchParams.set('utm_content', `leadId:${opts.leadId}`)
  // Cal.com copies metadata[...] query params onto the booking, where its
  // webhook (lib/calcom/normalize.ts) reads metadata.leadId / metadata.matterId.
  // Lawmatics booking forms: prefill the name parts too, so the booking can be
  // matched to the client's Lawmatics prospect.
  if (bookingProviderForUrl(baseUrl) === 'lawmatics' && opts.name) {
    const [first, ...rest] = opts.name.trim().split(/\s+/)
    if (first) url.searchParams.set('first_name', first)
    if (rest.length) url.searchParams.set('last_name', rest.join(' '))
  }
  if (bookingProviderForUrl(baseUrl) === 'calcom') {
    if (opts.matterId) url.searchParams.set('metadata[matterId]', opts.matterId)
    else if (opts.leadId) url.searchParams.set('metadata[leadId]', opts.leadId)
  }
  return url.toString()
}

export async function getCalendlyUrls(): Promise<CalendlyUrlMap> {
  const { data } = await getAdminClient()
    .from('scheduling_settings')
    .select('calendly_urls')
    .eq('id', 1)
    .maybeSingle()
  return sanitizeCalendlyUrls((data as { calendly_urls?: unknown } | null)?.calendly_urls)
}
