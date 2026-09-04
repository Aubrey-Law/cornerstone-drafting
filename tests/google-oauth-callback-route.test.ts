import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
  fetchAccountEmail: vi.fn(),
  store: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/googleCalendar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/googleCalendar')>('@/lib/googleCalendar')
  return {
    ...actual,
    exchangeCode: mocks.exchangeCode,
    fetchAccountEmail: mocks.fetchAccountEmail,
  }
})
vi.mock('@/lib/calendarConnections', () => ({ storeCalendarConnection: mocks.store }))
vi.mock('@/lib/requestOrigin', () => ({ getRequestOrigin: () => 'https://app.test' }))
vi.mock('@/lib/supabaseServer', () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}))

import { GET } from '@/app/api/admin/google/callback/route'
import type { NextRequest } from 'next/server'

function request(params: Record<string, string>): NextRequest {
  const url = new URL('https://app.test/api/admin/google/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return { nextUrl: url } as unknown as NextRequest
}

function state(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Query-string decoding: `+` is a space, which decodeURIComponent leaves alone. */
function locationText(res: Response): string {
  return decodeURIComponent((res.headers.get('location') ?? '').replace(/\+/g, ' '))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'scott@example.com' } } })
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'attorney' } })
  mocks.fetchAccountEmail.mockResolvedValue('scott@example.com')
})

describe('the google callback', () => {
  it('stores a connection that has a refresh token', async () => {
    mocks.exchangeCode.mockResolvedValue({
      access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid',
    })

    const res = await GET(request({ code: 'abc' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('gcal_connected=1')
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', refresh_token: 'r' }),
    )
  })

  it('refuses a connection with no refresh token instead of storing a time bomb', async () => {
    // It would work for an hour and then fail silently with nothing to renew it.
    // Google omits the refresh token when consent was granted previously, so the
    // fix is to revoke and reconnect — which the message has to say, because
    // nothing about the symptom points at it.
    mocks.exchangeCode.mockResolvedValue({ access_token: 'a', expires_in: 3600 })

    const res = await GET(request({ code: 'abc' }))

    expect(mocks.store).not.toHaveBeenCalled()
    expect(locationText(res)).toMatch(/myaccount\.google\.com\/permissions/)
  })

  it('refuses a caller who is not staff', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'client' } })

    const res = await GET(request({ code: 'abc' }))

    expect(res.headers.get('location')).toContain('gcal_error=forbidden')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const res = await GET(request({ code: 'abc' }))

    expect(res.headers.get('location')).toContain('gcal_error=forbidden')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('will not be turned into an open redirect by the unsigned state', async () => {
    // The error branches redirect before any session check, so an unvalidated
    // returnTo is an unauthenticated open redirect on the firm's own domain.
    const res = await GET(request({
      error: 'access_denied',
      state: state({ returnTo: 'https://evil.example.com/phish' }),
    }))

    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://app.test/')
    expect(location).not.toContain('evil.example.com')
  })

  it('reports a declined consent in words rather than a raw error code', async () => {
    const res = await GET(request({ error: 'access_denied' }))

    expect(locationText(res)).toMatch(/consent was declined/i)
  })

  it('handles the callback arriving with no code at all', async () => {
    const res = await GET(request({}))

    expect(res.headers.get('location')).toContain('gcal_error=no_code')
    expect(mocks.store).not.toHaveBeenCalled()
  })
})
