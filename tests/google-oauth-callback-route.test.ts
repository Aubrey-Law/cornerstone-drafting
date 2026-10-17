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
import { NextResponse, type NextRequest } from 'next/server'
import { beginOAuthState } from '@/lib/auth/oauthState'

/** What the connect route hands the browser: `state` plus its cookie value. */
function started(userId = 'user-1') {
  const { state, withCookie } = beginOAuthState('google', userId, '/admin/settings?tab=google')
  const cookie = withCookie(NextResponse.next()).cookies.get('cs_oauth_google')?.value ?? ''
  return { state, cookie }
}

function request(params: Record<string, string>, cookie: string | null = null): NextRequest {
  const url = new URL('https://app.test/api/admin/google/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const cookies = { get: (name: string) => (name === 'cs_oauth_google' && cookie ? { name, value: cookie } : undefined) }
  return { nextUrl: url, cookies } as unknown as NextRequest
}

/** A callback from the browser that began the connect, as `user-1`. */
function ownRequest(params: Record<string, string>): NextRequest {
  const { state, cookie } = started()
  return request({ ...params, state }, cookie)
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

    const res = await GET(ownRequest({ code: 'abc' }))

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

    const res = await GET(ownRequest({ code: 'abc' }))

    expect(mocks.store).not.toHaveBeenCalled()
    expect(locationText(res)).toMatch(/myaccount\.google\.com\/permissions/)
  })

  it('refuses a caller who is not staff', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'client' } })

    const res = await GET(ownRequest({ code: 'abc' }))

    expect(res.headers.get('location')).toContain('gcal_error=forbidden')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const res = await GET(ownRequest({ code: 'abc' }))

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

  it('refuses a callback whose state did not start in this browser', async () => {
    // Anyone can build a consent URL with our public client id. Without the
    // cookie the connect route set, the grant must not be stored.
    const { state: forged } = started()
    const res = await GET(request({ code: 'abc', state: forged }))

    expect(locationText(res)).toMatch(/different browser/)
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
  })

  it('refuses a state whose nonce does not match the cookie', async () => {
    const mine = started()
    const other = started()
    const res = await GET(request({ code: 'abc', state: other.state }, mine.cookie))

    expect(locationText(res)).toMatch(/different browser/)
    expect(mocks.store).not.toHaveBeenCalled()
  })

  it('never authenticates from a bearer token placed in state', async () => {
    // The old callback accepted state.token as the staff session, which let a
    // staff member's JWT ride a consent URL clicked by someone else.
    const res = await GET(request({ code: 'abc', state: state({ token: 'staff-jwt', returnTo: '/admin' }) }))

    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
    expect(locationText(res)).toMatch(/different browser/)
  })

  it('refuses when the signed-in user is not the one who started the connect', async () => {
    const { state: begun, cookie } = started('user-2')
    const res = await GET(request({ code: 'abc', state: begun }, cookie))

    expect(res.headers.get('location')).toContain('gcal_error=forbidden')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('clears the single-use state cookie on the way out', async () => {
    mocks.exchangeCode.mockResolvedValue({
      access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid',
    })

    const res = await GET(ownRequest({ code: 'abc' }))

    expect(res.headers.get('set-cookie')).toMatch(/cs_oauth_google=;.*Max-Age=0/i)
  })
})
