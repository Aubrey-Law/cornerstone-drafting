import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HANDOFF_TYPE,
  SignInError,
  fetchProfile,
  readSupabaseConfig,
  requestToken,
  resolveMessageParent,
  signIn,
  type StepId,
  type StepState,
} from '../signIn'

const config = { url: 'https://project.supabase.co', anonKey: 'anon-key' }

const TOKEN_OK = {
  access_token: 'access-123',
  refresh_token: 'refresh-456',
  expires_at: 1893456000,
  user: { email: 'scott@aubreylegal.com' },
}

const PROFILE_OK = {
  email: 'scott@aubreylegal.com',
  name: 'Scott Aubrey',
  role: 'attorney',
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

/** A fetch that answers the Supabase token URL and /api/addin/session. */
function stubFetch(overrides: { token?: Response; profile?: Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/auth/v1/token')) return overrides.token ?? jsonResponse(TOKEN_OK)
    if (url.includes('/api/addin/session')) return overrides.profile ?? jsonResponse(PROFILE_OK)
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

const officeWith = (messageParent: (message: string) => void) => () => ({
  onReady: async () => {},
  context: { ui: { messageParent } },
})

describe('readSupabaseConfig', () => {
  it('reads the app’s own NEXT_PUBLIC_ values', () => {
    expect(
      readSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toEqual(config)
  })

  it('fails with a message naming the missing variables', () => {
    // A build with no Supabase values cannot sign anyone in. The dialog has no
    // console, so this has to be legible on screen rather than thrown into the
    // void — and it must not present as a hang.
    expect(() => readSupabaseConfig({})).toThrow(SignInError)
    expect(() => readSupabaseConfig({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe('requestToken', () => {
  it('posts the password grant with the anon key', async () => {
    const fetchMock = stubFetch()
    const session = await requestToken('scott@aubreylegal.com', 'hunter2', {
      fetch: fetchMock,
      config,
    })

    expect(session).toEqual({
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: 1893456000,
      email: 'scott@aubreylegal.com',
    })

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://project.supabase.co/auth/v1/token?grant_type=password')
    expect((init as RequestInit).headers).toMatchObject({ apikey: 'anon-key' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'scott@aubreylegal.com',
      password: 'hunter2',
    })
  })

  it('turns a 400 into plain wrong-credentials wording', async () => {
    await expect(
      requestToken('scott@aubreylegal.com', 'wrong', {
        fetch: stubFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }),
        config,
      }),
    ).rejects.toThrow(/did not match/)
  })

  it('reports a timeout as a timeout, not a hang', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as unknown as typeof fetch

    await expect(
      requestToken('scott@aubreylegal.com', 'hunter2', { fetch: timeout, config }),
    ).rejects.toThrow(/did not respond within/)
  })
})

describe('fetchProfile', () => {
  it('reports a 403 as missing firm access', async () => {
    await expect(
      fetchProfile('access-123', { fetch: stubFetch({ profile: jsonResponse({}, 403) }) }),
    ).rejects.toThrow(/does not have firm access/)
  })

  it('sends the token as a bearer to the route that gates on it', async () => {
    const fetchMock = stubFetch()
    await fetchProfile('access-123', { fetch: fetchMock })

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/addin/session')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer access-123',
    })
  })
})

describe('resolveMessageParent', () => {
  it('returns null on the deadline rather than waiting forever', async () => {
    // The whole reason this module exists: the old dialog reached messageParent
    // through one optional chain in one callback, and when Office was not there
    // at that instant nothing was called and nothing was reported.
    const started = Date.now()
    await expect(resolveMessageParent(150, () => null)).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('finds messageParent once Office appears', async () => {
    // Office arriving late is the normal case in a cold dialog, and the reason
    // this polls instead of trusting a single readiness callback.
    const appearsAt = Date.now() + 150
    const getOffice = () =>
      Date.now() >= appearsAt ? { onReady: async () => {}, context: { ui: { messageParent: () => {} } } } : null

    await expect(resolveMessageParent(3_000, getOffice)).resolves.toBeTypeOf('function')
  })
})

describe('signIn', () => {
  let messageParent: ReturnType<typeof vi.fn>

  beforeEach(() => {
    messageParent = vi.fn()
  })

  it('hands the pane exactly the payload session.ts parses', async () => {
    const result = await signIn('scott@aubreylegal.com', 'hunter2', {
      fetch: stubFetch(),
      config,
      getOffice: officeWith(messageParent),
    })

    expect(result.handedOff).toBe(true)
    expect(messageParent).toHaveBeenCalledTimes(1)
    expect(JSON.parse(messageParent.mock.calls[0][0] as string)).toEqual({
      type: HANDOFF_TYPE,
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: 1893456000,
      email: 'scott@aubreylegal.com',
    })
  })

  it('reports each step so a failure names itself', async () => {
    const seen: [StepId, StepState][] = []
    await signIn('scott@aubreylegal.com', 'hunter2', {
      fetch: stubFetch(),
      config,
      getOffice: officeWith(messageParent),
      onStep: (id, state) => seen.push([id, state]),
    })

    expect(seen).toEqual([
      ['credentials', 'running'],
      ['credentials', 'done'],
      ['access', 'running'],
      ['access', 'done'],
      ['handoff', 'running'],
      ['handoff', 'done'],
    ])
  })

  it('marks the failing step and stops there', async () => {
    const seen: [StepId, StepState][] = []
    await expect(
      signIn('scott@aubreylegal.com', 'hunter2', {
        fetch: stubFetch({ profile: jsonResponse({}, 403) }),
        config,
        getOffice: officeWith(messageParent),
        onStep: (id, state) => seen.push([id, state]),
      }),
    ).rejects.toThrow(/firm access/)

    expect(seen).toEqual([
      ['credentials', 'running'],
      ['credentials', 'done'],
      ['access', 'running'],
      ['access', 'failed'],
    ])
    expect(messageParent).not.toHaveBeenCalled()
  })

  it('keeps the session when Office never turns up, for the paste fallback', async () => {
    const result = await signIn('scott@aubreylegal.com', 'hunter2', {
      fetch: stubFetch(),
      config,
      getOffice: () => null,
      officeTimeoutMs: 150,
      onStep: () => {},
    })

    expect(result.handedOff).toBe(false)
    expect(result.session.accessToken).toBe('access-123')
  })
})
