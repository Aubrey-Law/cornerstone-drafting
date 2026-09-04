import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStored: vi.fn(),
  getAny: vi.fn(),
  store: vi.fn(),
}))

vi.mock('@/lib/calendarConnections', () => ({
  getStoredCalendarConnection: mocks.getStored,
  getAnyConnectionForProvider: mocks.getAny,
  storeCalendarConnection: mocks.store,
}))

import {
  exchangeCode,
  getAccessToken,
  getAuthUrl,
  getGoogleConfigIssue,
  hasCalendarScope,
  isGoogleConfigured,
  toGoogleDisplayError,
} from '@/lib/googleCalendar'

const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALENDAR_REDIRECT_URI: 'https://app.test/api/admin/google/callback',
}

function configure() {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
}

beforeEach(() => {
  vi.clearAllMocks()
  configure()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('configuration', () => {
  it('names the missing variable rather than failing opaquely', () => {
    vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', '')
    expect(isGoogleConfigured()).toBe(false)
    expect(getGoogleConfigIssue()).toContain('GOOGLE_CALENDAR_CLIENT_SECRET')
  })

  it('reports configured when all three are present', () => {
    expect(isGoogleConfigured()).toBe(true)
    expect(getGoogleConfigIssue()).toBeNull()
  })
})

describe('the consent URL', () => {
  it('asks for offline access and forces consent, or there is no refresh token', () => {
    // Both are load-bearing. Without access_type=offline Google issues no
    // refresh token at all; without prompt=consent it issues one only on an
    // account's first ever grant, so a reconnect silently produces a connection
    // that dies at the first expiry and looks healthy until then.
    const url = new URL(getAuthUrl())

    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('requests the calendar scope and round-trips state', () => {
    const url = new URL(getAuthUrl('some-state'))

    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar')
    expect(url.searchParams.get('state')).toBe('some-state')
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.GOOGLE_CALENDAR_REDIRECT_URI)
  })
})

describe('token exchange', () => {
  it('turns a redirect_uri_mismatch into the thing to actually go and fix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'redirect_uri_mismatch' }),
      { status: 400 },
    )))

    await expect(exchangeCode('abc')).rejects.toThrow(/Authorised redirect URI/i)
  })

  it('passes an unrecognised error through unchanged', () => {
    expect(toGoogleDisplayError('something else entirely')).toBe('something else entirely')
  })
})

describe('getAccessToken', () => {
  const future = () => new Date(Date.now() + 3_600_000).toISOString()
  const past = () => new Date(Date.now() - 60_000).toISOString()

  it('says the calendar is not connected rather than throwing something obscure', async () => {
    mocks.getStored.mockResolvedValue(null)
    mocks.getAny.mockResolvedValue(null)

    await expect(getAccessToken('user-1')).rejects.toThrow(/not connected/i)
  })

  it('uses a still-valid token without a network call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    mocks.getStored.mockResolvedValue({ access_token: 'live', expires_at: future() })

    expect(await getAccessToken('user-1')).toBe('live')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the stored refresh token, because Google does not return one on refresh', async () => {
    // Overwriting with the absent value would discard the only means of renewal
    // and turn every expiry into a manual reconnect.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'fresh', expires_in: 3600 }),
      { status: 200 },
    )))
    mocks.getStored.mockResolvedValue({
      user_id: 'user-1',
      access_token: 'stale',
      refresh_token: 'the-only-one',
      expires_at: past(),
      email: 'scott@example.com',
      scopes: 'openid',
    })

    expect(await getAccessToken('user-1')).toBe('fresh')
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', refresh_token: 'the-only-one' }),
    )
  })

  it('refuses an expired connection that has nothing to refresh with', async () => {
    mocks.getStored.mockResolvedValue({
      user_id: 'user-1',
      access_token: 'stale',
      refresh_token: null,
      expires_at: past(),
    })

    await expect(getAccessToken('user-1')).rejects.toThrow(/reconnect/i)
  })

  it('falls back to the firm-wide google connection, never a microsoft one', async () => {
    mocks.getStored.mockResolvedValue(null)
    mocks.getAny.mockResolvedValue({ access_token: 'firm-wide', expires_at: future() })

    expect(await getAccessToken(null)).toBe('firm-wide')
    expect(mocks.getAny).toHaveBeenCalledWith('google')
  })
})

describe('hasCalendarScope', () => {
  it('is true only when the calendar scope is actually granted', () => {
    expect(hasCalendarScope('openid email https://www.googleapis.com/auth/calendar')).toBe(true)
    expect(hasCalendarScope('openid email')).toBe(false)
    expect(hasCalendarScope(null)).toBe(false)
  })

  it('does not match the read-only scope as though it were full access', () => {
    expect(hasCalendarScope('https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
  })
})
