import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeCode, getLawmaticsAccessToken } from '@/lib/lawmatics'
import { GET as callback } from '@/app/api/lawmatics/callback/route'
import { GET as status } from '@/app/api/lawmatics/status/route'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  select: vi.fn(),
  upsert: vi.fn(),
  requireAdmin: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({
    select: mocks.select,
    upsert: mocks.upsert,
  }) }),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseServer', () => ({
  createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }),
}))

const token = 'stored-token-that-must-stay-secret'
const updatedAt = '2026-09-15T12:00:00.000Z'
const adminRequest = () => new Request('https://example.com/api/lawmatics/status')
function callbackRequest(query = 'code=auth-code&state=expected-state') {
  return new NextRequest(`https://example.com/api/lawmatics/callback?${query}`, {
    headers: { cookie: 'lawmatics_oauth_state=expected-state' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  mocks.select.mockReturnValue({ eq: () => ({ maybeSingle: mocks.maybeSingle }) })
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'staff-id' })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'staff-id' } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Lawmatics access token', () => {
  it('uses the stored token even when legacy expiry and refresh fields exist', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: {
      access_token: token, refresh_token: 'legacy-refresh', expires_at: '2000-01-01',
    }, error: null })
    await expect(getLawmaticsAccessToken()).resolves.toBe(token)
    expect(mocks.select).toHaveBeenCalledWith('access_token')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a missing connection', async () => {
    await expect(getLawmaticsAccessToken()).rejects.toThrow('Lawmatics is not connected')
  })

  it('sanitizes database read errors without logging token material', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: token } })
    await expect(getLawmaticsAccessToken()).rejects.toThrow('Lawmatics connection could not be read')
    expect(JSON.stringify(logger.mock.calls)).not.toContain(token)
  })
})

describe('Lawmatics OAuth exchange', () => {
  it('returns only the access token, ignoring legacy provider metadata', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: token, refresh_token: 'legacy', expires_in: 3600 }))
    await expect(exchangeCode('auth-code')).resolves.toEqual({ access_token: token })
  })

  it('rejects a malformed token response safely', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: token }))
    await expect(exchangeCode('auth-code')).rejects.toThrow('Lawmatics token exchange failed')
  })

  it('does not include the raw provider error in the exception', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(token, { status: 400 }))
    await expect(exchangeCode('auth-code')).rejects.toThrow(/^Lawmatics token exchange failed$/)
  })

  it('does not include transport errors in the exception', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(token))
    await expect(exchangeCode('auth-code')).rejects.toThrow(/^Lawmatics token exchange failed$/)
  })
})

describe('Lawmatics status', () => {
  it('returns a safe connected shape without token prefixes or expiry metadata', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: {
      access_token: token, updated_at: updatedAt, expires_at: '2000-01-01',
    }, error: null })
    const body = await (await status(adminRequest())).json()
    expect(body).toEqual({ connected: true, updatedAt })
    expect(JSON.stringify(body)).not.toContain(token.slice(0, 8))
  })

  it('returns the same shape for a missing connection', async () => {
    expect(await (await status(adminRequest())).json()).toEqual({ connected: false, updatedAt: null })
  })

  it('does not return raw database errors', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: token } })
    expect(await (await status(adminRequest())).json()).toEqual({
      connected: false, updatedAt: null, error: 'Lawmatics connection could not be read',
    })
  })

  it('denies an unauthorized request before querying tokens', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response(null, { status: 403 }) })
    expect((await status(adminRequest())).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe('Lawmatics callback', () => {
  it('stores null expiry and refresh token and clears the state cookie', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'attorney' }, error: null })
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: token }))
    const response = await callback(callbackRequest())
    expect(response.headers.get('location')).toBe('https://example.com/admin/matters?lm_connected=1')
    expect(mocks.upsert).toHaveBeenCalledWith({
      id: 'singleton', access_token: token, refresh_token: null, expires_at: null,
      updated_at: expect.any(String),
    })
    expect(response.cookies.get('lawmatics_oauth_state')?.value).toBe('')
  })

  it.each(['wrong-state!!!', 'short', ''])('rejects invalid OAuth state %j without exchanging the code', async (state) => {
    const response = await callback(callbackRequest(`code=auth-code&state=${state}`))
    expect(response.headers.get('location')).toContain('lm_error=invalid_state')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('denies non-staff users before exchanging tokens', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callback(callbackRequest())
    expect(response.headers.get('location')).toContain('lm_error=forbidden')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not put raw database errors into the redirect', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'attorney' }, error: null })
    mocks.upsert.mockResolvedValue({ error: { message: token } })
    vi.mocked(fetch).mockResolvedValue(Response.json({ access_token: token }))
    const response = await callback(callbackRequest())
    expect(response.headers.get('location')).toBe('https://example.com/admin/matters?lm_error=connection_failed')
  })

  it('does not reflect arbitrary provider error query values', async () => {
    const response = await callback(callbackRequest(`error=${token}`))
    expect(response.headers.get('location')).toBe('https://example.com/admin/matters?lm_error=authorization_failed')
    expect(fetch).not.toHaveBeenCalled()
  })
})
