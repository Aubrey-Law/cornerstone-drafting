import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { buildCalendlyLink, sanitizeCalendlyUrls } from '@/lib/calendly/links'

describe('sanitizeCalendlyUrls', () => {
  it('keeps valid meeting-type keys with calendly.com https URLs', () => {
    expect(sanitizeCalendlyUrls({
      discovery_call: 'https://calendly.com/aubreylaw/discovery',
      pmps: 'https://calendly.com/aubreylaw/pmps',
    })).toEqual({
      discovery_call: 'https://calendly.com/aubreylaw/discovery',
      pmps: 'https://calendly.com/aubreylaw/pmps',
    })
  })

  it('keeps Cal.com, Lawmatics, and other https booking pages, trimmed', () => {
    expect(sanitizeCalendlyUrls({
      discovery_call: ' https://cal.com/aubreylaw/discovery ',
      pmps: 'https://app.lawmatics.com/booking/abc',
      draft_review: 'https://book.aubreylegal.com/review',
    })).toEqual({
      discovery_call: 'https://cal.com/aubreylaw/discovery',
      pmps: 'https://app.lawmatics.com/booking/abc',
      draft_review: 'https://book.aubreylegal.com/review',
    })
  })

  it('drops unknown keys, non-https URLs, credentials, and non-string values', () => {
    expect(sanitizeCalendlyUrls({
      not_a_type: 'https://calendly.com/x',
      discovery_call: 'javascript:alert(1)',
      pmps: 42,
      signing_appointment: 'http://calendly.com/insecure',
      draft_review: 'https://user:pass@cal.com/x',
      client_call: 'calendly.com/no-scheme',
    })).toEqual({})
  })

  it('returns {} for non-object input', () => {
    expect(sanitizeCalendlyUrls(null)).toEqual({})
    expect(sanitizeCalendlyUrls('nope')).toEqual({})
  })
})

describe('buildCalendlyLink', () => {
  const base = 'https://calendly.com/aubreylaw/discovery'

  it('adds prefill and utm params', () => {
    const url = new URL(buildCalendlyLink(base, {
      name: 'Avery Stone',
      email: 'avery@example.com',
      leadId: '123e4567-e89b-12d3-a456-426614174000',
      channel: 'email',
    }))
    expect(url.searchParams.get('name')).toBe('Avery Stone')
    expect(url.searchParams.get('email')).toBe('avery@example.com')
    expect(url.searchParams.get('utm_source')).toBe('app')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_content')).toBe('leadId:123e4567-e89b-12d3-a456-426614174000')
  })

  it('prefers matterId over leadId and omits absent prefill', () => {
    const url = new URL(buildCalendlyLink(base, {
      leadId: '123e4567-e89b-12d3-a456-426614174000',
      matterId: '223e4567-e89b-12d3-a456-426614174000',
      channel: 'staff',
    }))
    expect(url.searchParams.get('utm_content')).toBe('matterId:223e4567-e89b-12d3-a456-426614174000')
    expect(url.searchParams.has('name')).toBe(false)
    expect(url.searchParams.has('email')).toBe(false)
  })
})
