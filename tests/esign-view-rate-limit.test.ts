import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The signing page's own fetch is rate limited, and separately from the POST.
 *
 * GET /api/sign/[token] was the one public token endpoint in the app with no
 * guard while POST had one — and it writes: the first view flips the session to
 * `viewed` and inserts an audit row. The source-shape test in
 * tests/esign-sign-route.test.ts asserted only that the file mentions the
 * guard, which POST's call satisfied, so the gap sat there in plain sight.
 *
 * This drives the real handlers through the real guard with only the rate-limit
 * RPC faked, so it fails if the call is removed, if it stops being awaited, or
 * if its 429 is swallowed on the way back.
 */

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  /** bucket -> whether the next consume is allowed. */
  allow: new Map<string, boolean>(),
  consumed: [] as Array<{ bucket: string; limit: number; key: string }>,
  reset() {
    this.allow = new Map()
    this.consumed = []
  },
}))

vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async (cfg: { bucket: string; limit: number }, key: string) => {
    state.consumed.push({ bucket: cfg.bucket, limit: cfg.limit, key })
    const ok = state.allow.get(cfg.bucket) ?? true
    return { ok, count: 1, limit: cfg.limit, retryAfterSeconds: ok ? 0 : 42 }
  }),
}))

// Everything past the guard. None of it should be reached on a 429, which is
// part of what this asserts: a blocked request must not touch the database.
const touched = vi.hoisted(() => ({ db: 0, r2: 0 }))

vi.mock('@/lib/supabaseAdmin', () => ({
  ADMIN_EMAIL: 'firm@example.com',
  getAdminClient: () => {
    touched.db += 1
    throw new Error('the guard should have returned before any database work')
  },
}))
vi.mock('@/lib/r2', () => ({
  getR2Client: () => { touched.r2 += 1; throw new Error('unreachable') },
  r2Bucket: () => 'bucket',
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://r2.invalid/x') }))
vi.mock('@aws-sdk/client-s3', () => ({ GetObjectCommand: class {} }))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))
vi.mock('@/lib/esign/nativeSeal', () => ({ sealSignedAgreement: vi.fn() }))
vi.mock('@/lib/esign/completion', () => ({ completeWorkspaceAgreement: vi.fn() }))
vi.mock('@/lib/appointments/settings', () => ({ getSchedulingSettings: vi.fn(async () => ({ timezone: 'America/New_York' })) }))

const TOKEN = 'a-token-that-is-never-looked-up'

function request(method: 'GET' | 'POST') {
  return new Request(`https://portal.example.com/api/sign/${TOKEN}`, {
    method,
    headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
}

const params = Promise.resolve({ token: TOKEN })

beforeEach(() => {
  state.reset()
  touched.db = 0
  touched.r2 = 0
  vi.clearAllMocks()
})

describe('GET /api/sign/[token]', () => {
  it('consumes its own bucket, not the one POST spends', async () => {
    const { GET, POST } = await import('@/app/api/sign/[token]/route')
    state.allow.set('esign-view', false)
    state.allow.set('esign-sign', false)

    await GET(request('GET'), { params })
    await POST(request('POST'), { params })

    const buckets = state.consumed.map(c => c.bucket)
    expect(new Set(buckets).size).toBe(2)
    // A client reloading their agreement must not spend the budget they need
    // to submit the signature.
    expect(buckets[0]).not.toBe(buckets[1])
  })

  it('turns a spent budget into a 429 the caller can act on', async () => {
    const { GET } = await import('@/app/api/sign/[token]/route')
    state.allow.set('esign-view', false)

    const response = await GET(request('GET'), { params })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Too many') })
  })

  it('does no database work once the budget is spent', async () => {
    const { GET } = await import('@/app/api/sign/[token]/route')
    state.allow.set('esign-view', false)

    await GET(request('GET'), { params })

    // The point of guarding a writing endpoint: a blocked view neither resolves
    // the session nor records that it was opened.
    expect(touched.db).toBe(0)
  })

  it('keys the limit on the caller, not the token', async () => {
    const { GET } = await import('@/app/api/sign/[token]/route')
    state.allow.set('esign-view', false)

    await GET(request('GET'), { params })

    // Keying on the token would make the limit useless — a script walking the
    // keyspace presents a different one every time.
    expect(state.consumed[0]?.key).toBe('203.0.113.7')
    expect(state.consumed[0]?.key).not.toContain(TOKEN)
  })

  it('leaves room for a real signer, who fetches once per page load', async () => {
    const { GET } = await import('@/app/api/sign/[token]/route')
    state.allow.set('esign-view', false)

    await GET(request('GET'), { params })

    // Several people can share one address behind household or carrier NAT, and
    // a false 429 here is a client who cannot open their fee agreement.
    expect(state.consumed[0]?.limit).toBeGreaterThanOrEqual(60)
  })
})
