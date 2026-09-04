import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy, config } from '@/proxy'
import { GATED_PATH_PATTERNS, LOGIN_PATH } from '@/lib/auth/gate'

const SUPABASE_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of SUPABASE_ENV) saved[name] = process.env[name]
})
afterEach(() => {
  for (const name of SUPABASE_ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

const req = (path: string) => new NextRequest(`https://workbench.test${path}`)

describe('the proxy', () => {
  it('fails closed with 503 when Supabase is not configured', async () => {
    for (const name of SUPABASE_ENV) delete process.env[name]
    const res = await proxy(req('/matters'))
    expect(res.status).toBe(503)
  })

  it('fails closed with JSON 503 for an API path when Supabase is not configured', async () => {
    for (const name of SUPABASE_ENV) delete process.env[name]
    const res = await proxy(req('/api/staff/matters'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Service Unavailable' })
  })

  it('serves a public path without needing Supabase at all', async () => {
    for (const name of SUPABASE_ENV) delete process.env[name]
    // Health is how a monitor asks whether the app is up. Gating it behind the
    // configuration it is meant to report on would make it useless.
    const res = await proxy(req('/api/health'))
    expect(res.status).toBe(200)
  })
})

/**
 * A path absent from the matcher is a path the proxy never sees, and therefore
 * a path with no access control — silently, with a passing build. This ties the
 * matcher to the route lists in lib/auth/gate.ts so the two cannot drift.
 */
describe('the proxy matcher covers every gated route', () => {
  /** Next matcher syntax: `/matters/:path*` covers `/matters` and below. */
  const toRegExp = (pattern: string) => {
    const PARAM = '/:path*'
    const wildcard = pattern.endsWith(PARAM)
    const literal = wildcard ? pattern.slice(0, -PARAM.length) : pattern
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${escaped}${wildcard ? '(?:/.*)?' : ''}$`)
  }

  const matchers = config.matcher.map(toRegExp)
  const covers = (pathname: string) => matchers.some((re) => re.test(pathname))

  it('has a matcher list', () => {
    expect(config.matcher.length).toBeGreaterThan(0)
  })

  it.each(GATED_PATH_PATTERNS)('covers %s', (prefix) => {
    expect(covers(prefix), `${prefix} is gated but no matcher selects it`).toBe(true)
    if (prefix !== '/') {
      expect(covers(`${prefix}/deeper/still`), `${prefix} children are not selected`).toBe(true)
    }
  })

  it('covers the login page, so a signed-in user is redirected off it', () => {
    expect(covers(LOGIN_PATH)).toBe(true)
  })
})
