// Client-safe helpers for the per-meeting-type booking page URLs configured in
// Settings → Scheduling. Any https booking page is accepted so the firm can
// move between schedulers (Calendly, Cal.com, Lawmatics, …) without a code
// change; the provider is inferred from the host for provider-specific
// behavior such as Calendly's inline-embed events.

export type BookingProvider = 'calendly' | 'calcom' | 'lawmatics' | 'other'

export const BOOKING_PROVIDER_LABELS: Record<BookingProvider, string> = {
  calendly: 'Calendly',
  calcom: 'Cal.com',
  lawmatics: 'Lawmatics',
  other: 'booking page',
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/** An absolute https URL with a host and no embedded credentials. */
export function isBookingUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function bookingProviderForUrl(value: string): BookingProvider {
  let host: string
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (hostMatches(host, 'calendly.com')) return 'calendly'
  if (hostMatches(host, 'cal.com')) return 'calcom'
  if (hostMatches(host, 'lawmatics.com')) return 'lawmatics'
  return 'other'
}
