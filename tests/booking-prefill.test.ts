import { describe, expect, it, vi } from 'vitest'
import { nativeBookingPath, nativeBookingUrl, parseBookingPrefill } from '@/lib/bookings/prefill'

describe('booking page prefill links', () => {
  it('puts client details in the fragment only, and round-trips them', () => {
    vi.stubEnv('NEXT_PUBLIC_PORTAL_URL', 'https://portal.example.com')
    const prefill = { firstName: 'Mary Jane', lastName: 'van Buren', email: 'mary+law@example.com', phone: ' ' }
    const url = nativeBookingUrl('discovery-call', prefill)
    expect(url.startsWith('https://portal.example.com/book/discovery-call#')).toBe(true)
    expect(new URL(url).search).toBe('')
    expect(parseBookingPrefill(new URL(url).hash)).toEqual({ firstName: 'Mary Jane', lastName: 'van Buren', email: 'mary+law@example.com', phone: null })
    vi.unstubAllEnvs()
  })

  it('omits the fragment when there is nothing to fill', () => {
    expect(nativeBookingPath('signing')).toBe('/book/signing')
    expect(nativeBookingPath('signing', { firstName: '  ' })).toBe('/book/signing')
  })
})
