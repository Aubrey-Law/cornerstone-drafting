import { getAdminClient } from '@/lib/supabaseAdmin'
import { meetingTypeForKey, type MeetingTypeKey } from '@/lib/scheduling'

export type CalendlyLinkChannel = 'email' | 'sms' | 'portal' | 'staff'

export type CalendlyUrlMap = Partial<Record<MeetingTypeKey, string>>

function isCalendlyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).origin === 'https://calendly.com'
  } catch {
    return false
  }
}

export function sanitizeCalendlyUrls(value: unknown): CalendlyUrlMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const map: CalendlyUrlMap = {}
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    const meetingType = meetingTypeForKey(key)
    if (meetingType && isCalendlyUrl(url)) map[meetingType.key] = url
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
