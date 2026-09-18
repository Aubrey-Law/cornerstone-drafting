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
  /** Pages requested, in order — how the directory walk is observed. */
  pagesRequested: [] as number[],
  /** The whole auth directory the fake pages over. */
  directory: [] as Array<{ id: string; email: string; email_confirmed_at: string | null }>,
  /** Set to make createUser report the address as taken. */
  createUserDuplicate: false,
  confirmed: [] as string[],
  reset() {
    this.allow = new Map()
    this.consumed = []
    this.intake = { id: 'intake-1', email: 'client@example.com', status: 'draft' }
    this.createdUsers = 0
    this.listedUsers = 0
    this.pagesRequested = []
    this.directory = []
    this.createUserDuplicate = false
    this.confirmed = []
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
          if (state.createUserDuplicate) {
            return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } }
          }
          state.createdUsers += 1
          return { data: { user: { id: 'user-1' } }, error: null }
        }),
        // Pages the way GoTrue does: a slice plus nextPage, absent on the last.
        listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => {
          state.listedUsers += 1
          state.pagesRequested.push(page)
          const start = (page - 1) * perPage
          const users = state.directory.slice(start, start + perPage)
          const hasMore = start + perPage < state.directory.length
          return { data: { users, ...(hasMore ? { nextPage: page + 1 } : {}) }, error: null }
        }),
        updateUserById: vi.fn(async (id: string) => {
          state.confirmed.push(id)
          return { data: null, error: null }
        }),
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

describe('finding an account the directory already holds', () => {
  /** A directory with the wanted address buried past the first page. */
  function directoryOf(size: number, at: number) {
    state.directory = Array.from({ length: size }, (_, i) => ({
      id: `user-${i}`,
      email: i === at ? 'client@example.com' : `other-${i}@example.com`,
      email_confirmed_at: null,
    }))
    state.createUserDuplicate = true
  }

  it('pages past the first slice to find it', async () => {
    // The old code asked for one page of 1000 and treated a miss as "no such
    // account", so an address at 1200 was invisible and the intake was never
    // linked.
    directoryOf(1205, 1200)
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(200)
    expect(state.pagesRequested.length).toBeGreaterThan(1)
    // Found, and confirmed, which is what links the intake to the account.
    expect(state.confirmed).toEqual(['user-1200'])
  })

  it('stops at the last page rather than asking forever', async () => {
    directoryOf(450, 5)
    const { POST } = await import('@/app/api/intake/signup/route')

    await POST(signup(valid))

    // Found on page 1; no reason to read page 2.
    expect(state.pagesRequested).toEqual([1])
  })

  it('reads to the end before concluding the address is not there', async () => {
    state.directory = Array.from({ length: 450 }, (_, i) => ({
      id: `user-${i}`, email: `other-${i}@example.com`, email_confirmed_at: null,
    }))
    state.createUserDuplicate = true
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    // Every page, then the 409 — not a 409 because one page ran out.
    expect(state.pagesRequested).toEqual([1, 2, 3])
    expect(response.status).toBe(409)
  })

  it('surfaces a directory bigger than it will walk as an error, not a miss', async () => {
    // The failure this replaces was silent. Running off the end must not look
    // like "no such account" again.
    state.directory = Array.from({ length: 200 * 60 }, (_, i) => ({
      id: `user-${i}`, email: `other-${i}@example.com`, email_confirmed_at: null,
    }))
    state.createUserDuplicate = true
    const { POST } = await import('@/app/api/intake/signup/route')

    const response = await POST(signup(valid))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('look up') })
  })

  it('does not page the directory at all on the happy path', async () => {
    const { POST } = await import('@/app/api/intake/signup/route')

    await POST(signup(valid))

    expect(state.listedUsers).toBe(0)
  })
})
