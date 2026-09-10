import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The login page must never 503.
 *
 * `/auth/*` is public and short-circuits before Supabase is touched — except
 * `/auth/login`, which is deliberately excluded so an already-signed-in
 * visitor can be bounced to their home. That exclusion means the login page is
 * the only public path that resolves a session, and before this test it also
 * meant a session it could not resolve returned 503 there.
 *
 * That is a closed door with the key behind it. Whoever holds a cookie the app
 * cannot read is shut out of the one page that would replace it, and the
 * screen says only "temporarily unavailable" — nothing that would lead anyone
 * to clear cookies. Reported from production on 2026-09-10.
 *
 * `resolveSession` is stubbed rather than driven through a real Supabase
 * client, because what matters is the proxy's behaviour when session
 * resolution fails, whatever the cause — an unreadable cookie, a rotated
 * signing key, an unreachable backend.
 */
const resolveSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/session', () => ({
  resolveSession,
  resolveRole: vi.fn(async () => 'admin'),
}))

vi.mock('@/lib/supabase/roles', () => ({ readUserRole: vi.fn(async () => 'admin') }))

const { proxy } = await import('@/proxy')

const req = (path: string) => new NextRequest(`https://workbench.test${path}`)

const SUPABASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
}
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const [k, v] of Object.entries(SUPABASE_ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  resolveSession.mockReset()
})

afterEach(() => {
  for (const k of Object.keys(SUPABASE_ENV)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('a session that cannot be resolved', () => {
  it('still serves the login page, so the way back in stays open', async () => {
    resolveSession.mockResolvedValue({ ok: false })

    const res = await proxy(req('/auth/login'))

    expect(res.status).not.toBe(503)
    expect(res.status).toBeLessThan(400)
  })

  it('serves the login page even with a redirectTo, which is how a bounce arrives', async () => {
    resolveSession.mockResolvedValue({ ok: false })

    const res = await proxy(req('/auth/login?redirectTo=%2Fmatters'))

    expect(res.status).not.toBe(503)
  })

  it('still fails closed on a gated path, which is the rule this does not relax', async () => {
    resolveSession.mockResolvedValue({ ok: false })

    const res = await proxy(req('/matters'))

    // Serving a matter to someone the app cannot identify is the failure the
    // 503 exists to prevent. The login exception must not widen to this.
    expect(res.status).toBe(503)
  })

  it('still fails closed on an API path, as JSON', async () => {
    resolveSession.mockResolvedValue({ ok: false })

    const res = await proxy(req('/api/staff/matters'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Service Unavailable' })
  })
})

describe('a session that resolves normally', () => {
  it('still bounces a signed-in visitor off the login page', async () => {
    // The reason /auth/login resolves a session at all. Keeping this working
    // is what makes the fix above a narrowing of the failure case rather than
    // a removal of the feature.
    resolveSession.mockResolvedValue({ ok: true, userId: 'user-1', claimRole: 'admin' })

    const res = await proxy(req('/auth/login'))

    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/')
  })
})
