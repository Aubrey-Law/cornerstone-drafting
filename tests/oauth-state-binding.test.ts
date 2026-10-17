import { beforeEach, describe, expect, it, vi } from 'vitest'

// The connect routes must bind `state` to the browser that starts the flow,
// and the Microsoft callback must refuse a `state` that browser did not start.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  exchangeMicrosoftCode: vi.fn(),
  store: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: mocks.requireAdmin,
  redirectToLogin: () => new Response(null, { status: 307, headers: { location: 'https://app.test/auth/login' } }),
}))
vi.mock('@/lib/googleCalendar', () => ({
  getGoogleConfigIssue: () => null,
  getAuthUrl: (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
}))
vi.mock('@/lib/microsoftTeams', () => ({
  getMicrosoftConfigIssue: () => null,
  getMicrosoftAuthUrl: (state: string) => `https://login.microsoftonline.com/authorize?state=${state}`,
  exchangeMicrosoftCode: mocks.exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail: async () => 'staff@example.com',
  toMicrosoftDisplayError: (value: string) => value,
}))
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

import { NextRequest } from 'next/server'
import { GET as googleConnect } from '@/app/api/admin/google/connect/route'
import { GET as microsoftConnect } from '@/app/api/admin/microsoft/connect/route'
import { GET as microsoftCallback } from '@/app/api/admin/microsoft/callback/route'

function decodedLocation(res: Response): string {
  return decodeURIComponent((res.headers.get('location') ?? '').replace(/\+/g, ' '))
}

/** Run a connect route and return the `state` it sent and the cookie it set. */
async function connect(route: typeof googleConnect, cookieName: string) {
  const res = await route(new NextRequest('https://app.test/api/admin/x/connect'))
  const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
  const setCookie = res.headers.get('set-cookie') ?? ''
  const value = new RegExp(`${cookieName}=([^;]*)`).exec(setCookie)?.[1] ?? ''
  return { state, setCookie, value: decodeURIComponent(value) }
}

function callbackRequest(params: Record<string, string>, cookie?: string): NextRequest {
  const url = new URL('https://app.test/api/admin/microsoft/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url, cookie ? { headers: { cookie: `cs_oauth_microsoft=${encodeURIComponent(cookie)}` } } : undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'user-1' })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'attorney' } })
  mocks.exchangeMicrosoftCode.mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })
})

describe('connect routes', () => {
  it.each([
    ['google', googleConnect, 'cs_oauth_google'],
    ['microsoft', microsoftConnect, 'cs_oauth_microsoft'],
  ] as const)('%s sets an httpOnly state cookie scoped to its callback', async (provider, route, cookieName) => {
    const { state, setCookie, value } = await connect(route, cookieName)

    expect(state).not.toBe('')
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=lax/i)
    expect(setCookie).toContain(`Path=/api/admin/${provider}/callback`)
    expect(value.endsWith('.user-1')).toBe(true)
    // The nonce in the cookie is the one carried in state.
    const payload = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { n: string }
    expect(value.startsWith(`${payload.n}.`)).toBe(true)
  })

  it('sends a signed-out visitor to login instead of minting state', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response(null, { status: 401 }), userId: null })

    const res = await googleConnect(new NextRequest('https://app.test/api/admin/google/connect'))

    expect(res.headers.get('location')).toContain('/auth/login')
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('the microsoft callback', () => {
  it('stores the connection when state matches this browser and user', async () => {
    const { state, value } = await connect(microsoftConnect, 'cs_oauth_microsoft')

    const res = await microsoftCallback(callbackRequest({ code: 'abc', state }, value))

    expect(res.headers.get('location')).toContain('msteams_connected=1')
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', provider: 'microsoft' }))
  })

  it('refuses a state that did not start in this browser', async () => {
    const { state } = await connect(microsoftConnect, 'cs_oauth_microsoft')

    const res = await microsoftCallback(callbackRequest({ code: 'abc', state }))

    expect(decodedLocation(res)).toMatch(/different browser/)
    expect(mocks.exchangeMicrosoftCode).not.toHaveBeenCalled()
    expect(mocks.store).not.toHaveBeenCalled()
  })

  it('refuses when a different staff user is signed in than started the connect', async () => {
    const { state, value } = await connect(microsoftConnect, 'cs_oauth_microsoft')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } } })

    const res = await microsoftCallback(callbackRequest({ code: 'abc', state }, value))

    expect(res.headers.get('location')).toContain('msteams_error=forbidden')
    expect(mocks.store).not.toHaveBeenCalled()
  })
})
