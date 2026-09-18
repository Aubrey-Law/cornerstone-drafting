import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clientIpFrom } from '@/lib/clientIp'

/**
 * /intake/auth meters the token lookups it does on a stranger's behalf.
 *
 * The page is public, unauthenticated, and takes any string in the query. Every
 * presented token cost two service-role reads before it could be rejected —
 * `resolveIntakeByInviteToken` falls back from the hashed column to the legacy
 * plaintext one — and nothing counted them.
 *
 * The assertion that matters is not that a message renders. It is that the
 * lookup does not happen, so this spies on the resolver itself.
 */

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  allow: true,
  consumed: [] as Array<{ bucket: string; limit: number; windowSeconds: number; key: string }>,
  forwardedFor: '198.51.100.9, 10.0.0.1',
  reset() {
    this.allow = true
    this.consumed = []
    this.forwardedFor = '198.51.100.9, 10.0.0.1'
  },
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': state.forwardedFor }),
}))

vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async (cfg: { bucket: string; limit: number; windowSeconds: number }, key: string) => {
    state.consumed.push({ ...cfg, key })
    return { ok: state.allow, count: 1, limit: cfg.limit, retryAfterSeconds: state.allow ? 0 : 30 }
  }),
}))

const resolveIntakeByInviteToken = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken }))

vi.mock('@/lib/supabaseAdmin', () => ({
  ADMIN_EMAIL: 'firm@example.com',
  getAdminClient: () => ({ from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }),
}))
vi.mock('@/lib/supabaseServer', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}))
vi.mock('@/lib/firmConfig', () => ({
  getFirmConfig: () => ({ firmName: 'Aubrey Law', email: 'firm@example.com', phone: '(781) 474-3450' }),
}))
vi.mock('./IntakeAuthForm', () => ({ default: () => null }))
vi.mock('@/app/intake/auth/IntakeAuthForm', () => ({ default: () => null }))
vi.mock('next/image', () => ({ default: () => null }))

const render = async (searchParams: Record<string, string>) => {
  const { default: IntakeAuthPage } = await import('@/app/intake/auth/page')
  const element = await IntakeAuthPage({ searchParams: Promise.resolve(searchParams) })
  return renderToStaticMarkup(element)
}

beforeEach(() => {
  state.reset()
  resolveIntakeByInviteToken.mockClear()
  vi.clearAllMocks()
})

describe('/intake/auth rate limit', () => {
  it('does not look the token up once the budget is spent', async () => {
    state.allow = false

    const html = await render({ invite: 'si1.whatever.signature' })

    // The whole point: two service-role reads that do not happen.
    expect(resolveIntakeByInviteToken).not.toHaveBeenCalled()
    expect(html).toContain('Too many attempts')
  })

  it('looks it up normally while the caller has budget', async () => {
    const html = await render({ invite: 'si1.whatever.signature' })

    expect(resolveIntakeByInviteToken).toHaveBeenCalledOnce()
    expect(html).not.toContain('Too many attempts')
    // Resolver returns null here, so this is the existing invalid-link screen.
    expect(html).toContain('invalid or expired')
  })

  it('spends nothing on a link with no token at all', async () => {
    // A truncated paste does no database work, so it should not cost the
    // caller — or anyone sharing their address — a lookup.
    const html = await render({})

    expect(state.consumed).toEqual([])
    expect(html).toContain('Invalid link')
  })

  it('keys on the caller, in a bucket of its own', async () => {
    await render({ token: 'legacy-style-token' })

    expect(state.consumed).toHaveLength(1)
    expect(state.consumed[0]).toMatchObject({ bucket: 'intake-auth', windowSeconds: 60 })
    // Not the proxy hop, and not the raw header.
    expect(state.consumed[0]?.key).toBe('198.51.100.9')
  })

  it('leaves room for a household behind one address', async () => {
    await render({ invite: 'si1.a.b' })

    // A false block here means somebody cannot start their intake at all.
    expect(state.consumed[0]?.limit).toBeGreaterThanOrEqual(60)
  })
})

describe('clientIpFrom', () => {
  it('takes the client, not the proxy chain', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' })))
      .toBe('203.0.113.5')
  })

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '203.0.113.6' }))).toBe('203.0.113.6')
    expect(clientIpFrom(new Headers())).toBe('unknown')
  })

  it('does not hand back an empty key when the chain starts with a blank', () => {
    // The old inline version used `??`, which keeps '' — every caller sending a
    // leading comma would then share one bucket keyed on the empty string.
    // Same falsy-vs-nullish trap as the rest of this codebase's history.
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': ', 203.0.113.7', 'x-real-ip': '203.0.113.8' })))
      .toBe('203.0.113.8')
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '   ' }))).toBe('unknown')
  })
})
