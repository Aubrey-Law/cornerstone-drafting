import { describe, expect, it } from 'vitest'
import { bookingProviderForUrl, isBookingUrl } from '@/lib/bookings/provider'

describe('bookingProviderForUrl', () => {
  it('detects known schedulers by host, including subdomains', () => {
    expect(bookingProviderForUrl('https://calendly.com/aubreylaw/discovery')).toBe('calendly')
    expect(bookingProviderForUrl('https://cal.com/aubreylaw/discovery')).toBe('calcom')
    expect(bookingProviderForUrl('https://app.cal.com/aubreylaw/discovery')).toBe('calcom')
    expect(bookingProviderForUrl('https://aubreylaw.lawmatics.com/book')).toBe('lawmatics')
  })

  it('does not match lookalike hosts', () => {
    expect(bookingProviderForUrl('https://notcalendly.com/x')).toBe('other')
    expect(bookingProviderForUrl('https://calendly.com.evil.example/x')).toBe('other')
    expect(bookingProviderForUrl('not a url')).toBe('other')
  })
})

describe('isBookingUrl', () => {
  it('accepts absolute https URLs only', () => {
    expect(isBookingUrl('https://book.example.com/x')).toBe(true)
    expect(isBookingUrl('http://book.example.com/x')).toBe(false)
    expect(isBookingUrl('https://u:p@book.example.com/x')).toBe(false)
    expect(isBookingUrl('')).toBe(false)
    expect(isBookingUrl(null)).toBe(false)
  })
})
