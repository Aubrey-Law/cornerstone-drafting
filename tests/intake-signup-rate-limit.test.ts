import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/intake/signup meters both of its costs, separately.
 *
 * It is in PUBLIC_AUTH_PATHS, so the proxy demands no session. Every request
 * carrying a token spent two service-role reads before it could be rejected,
 * and nothing counted the attempts that reach `auth.admin.createUser` — or the
 * duplicate branch behind it, which pages through the auth directory.
 *
 * The two limits answer to different people: the reads are bounded per
 * address, the directory writes per invite. This drives the real handler and
 * asserts each one stops the work behind it.
 */

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  allow: new Map<string, boolean>(),
  consumed: [] as Array<{ bucket: string; limit: number; windowSeconds: number; key: string }>,
  /** What the invite resolves to; null is "no such invite". */
  intake: null as Record<string, unknown> | null,
  createdUsers: 0,
  listedUsers: 0,
  reset() {
    this.allow = new Map()
    this.consumed = []
    this.intake = { id: 'intake-1', email: 'client@example.com', status: 'draft' }
    this.createdUsers = 0
    this.listedUsers = 0
  },
}))

vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async (cfg: { bucket: string; limit: number; windowSeconds: number }, key: string) => {
    state.consumed.push({ ...cfg, key })
    const ok = state.allow.get(cfg.bucket) ?? true
    return { ok, count: 1, limit: cfg.limit, retryAfterSeconds: ok ? 0 : 900 }
  }),
}))

const resolveIntakeByInviteToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken }))

vi.mock('@/lib/supabaseAdmin', () => ({
  ADMIN_EMAIL: 'firm@example.com',
  getAdminClient: () => ({
    auth: {
      admin: {
        createUser: vi.fn(async () => {
          state.createdUsers += 1
          return { data: { user: { id: 'user-1' } }, error: null }
        }),
        listUsers: vi.fn(async () => {
          state.listedUsers += 1
          return { data: { users: [] }, error: null }
        }),
        updateUserById: vi.fn(async () => ({ data: null, error: null })),
      },
    },
    from: () => ({
      upsert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }), then: undefined }),
    }),
  }),
}))

function signup(body: Record<string, unknown>) {
  return new Request('https://portal.example.com/api/intake/signup', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.22, 10.0.0.1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const valid = {
  inviteToken: 'si1.payload.signature',
  email: 'client@example.com',
  password: 'a-long-enough-password',
}

beforeEach(() => {
  state.reset()
  resolveIntakeByInviteToken.mockImplementation(async () => state.intake)
  vi.clearAllMocks()
})

describe('per-address limit', () => {
  it('refuses before reading the body, let alone the invite', async () => {
    state.allow.set('intake-signup', false)
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(429)
    // The two service-role reads this route pays for any presented token.
    expect(resolveIntakeByInviteToken).not.toHaveBeenCalled()
    expect(state.createdUsers).toBe(0)
  })

  it('keys on the caller, not the proxy hop', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')
    await POST(signup(valid))

    expect(state.consumed[0]).toMatchObject({ bucket: 'intake-signup', key: '198.51.100.22' })
  })

  it('charges a malformed request too — it is the cheapest thing to send', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(new Request('https://portal.example.com/api/intake/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.22' },
      body: 'not json',
    }))

    expect(response.status).toBe(400)
    expect(state.consumed.map(c => c.bucket)).toEqual(['intake-signup'])
  })
})

describe('per-invite limit', () => {
  it('stops the account attempt without touching the auth directory', async () => {
    state.allow.set('intake-signup-account', false)
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    // The point: neither the write nor the directory paging behind it.
    expect(state.createdUsers).toBe(0)
    expect(state.listedUsers).toBe(0)
  })

  it('is keyed on the invite, which an attacker cannot vary', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')
    await POST(signup(valid))

    const account = state.consumed.find(c => c.bucket === 'intake-signup-account')
    // Not the address, and not the token — the intake the token resolved to.
    expect(account?.key).toBe('intake-1')
    expect(account?.windowSeconds).toBe(3600)
  })

  it('is not spent by a refusal that costs nothing', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')

    // Wrong address for this invitation: turned away before the directory.
    const response = await POST(signup({ ...valid, email: 'someone-else@example.com' }))

    expect(response.status).toBe(403)
    expect(state.consumed.map(c => c.bucket)).toEqual(['intake-signup'])
  })

  it('is not spent on an invite that does not resolve', async () => {
    state.intake = null
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(401)
    expect(state.consumed.map(c => c.bucket)).toEqual(['intake-signup'])
  })

  it('leaves room to fumble a password and come back', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')
    await POST(signup(valid))

    const account = state.consumed.find(c => c.bucket === 'intake-signup-account')
    expect(account?.limit).toBeGreaterThanOrEqual(3)
  })
})

describe('the happy path still works', () => {
  it('creates the account when both budgets allow it', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(200)
    expect(state.createdUsers).toBe(1)
    expect(state.consumed.map(c => c.bucket)).toEqual(['intake-signup', 'intake-signup-account'])
  })
})
