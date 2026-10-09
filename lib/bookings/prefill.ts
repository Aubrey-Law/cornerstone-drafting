import { portalUrl } from '@/lib/urls'

/** Who the firm's booking page should be filled in for. */
export interface BookingPrefill {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * The firm's own booking page for an appointment type. The client's details
 * ride in the URL fragment, which browsers never send to the server, so they
 * stay out of request logs; the page reads and then clears it.
 */
export function nativeBookingUrl(slug: string, prefill?: BookingPrefill | null): string {
  return portalUrl(nativeBookingPath(slug, prefill))
}

/** Same page as a path, for embedding on whichever host staff are using. */
export function nativeBookingPath(slug: string, prefill?: BookingPrefill | null): string {
  const path = `/book/${encodeURIComponent(slug)}`
  const fragment = bookingPrefillFragment(prefill)
  return fragment ? `${path}#${fragment}` : path
}

export function bookingPrefillFragment(prefill?: BookingPrefill | null): string {
  if (!prefill) return ''
  const params = new URLSearchParams()
  const add = (key: string, value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (trimmed) params.set(key, trimmed)
  }
  add('first', prefill.firstName)
  add('last', prefill.lastName)
  add('email', prefill.email)
  add('phone', prefill.phone)
  return params.toString()
}

/** Reads a fragment written by `bookingPrefillFragment`. */
export function parseBookingPrefill(fragment: string): BookingPrefill {
  const params = new URLSearchParams(fragment.replace(/^#/, ''))
  const read = (key: string) => params.get(key)?.trim().slice(0, 200) || null
  return { firstName: read('first'), lastName: read('last'), email: read('email'), phone: read('phone') }
}
