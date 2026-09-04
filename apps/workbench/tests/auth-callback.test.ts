import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { exchangeCodeForSession, signOut, ensureProfileForUser } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  ensureProfileForUser: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}))
vi.mock('@/lib/supabase/profile', () => ({ ensureProfileForUser }))

import { GET } from '@/app/auth/callback/route'

const call = (query: string) =>
  GET(new Request(`https://workbench.test/auth/callback${query}`))

const signedInAs = (email: string | null, fullName: string | null = null) =>
  exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: 'u-1', email, user_metadata: fullName ? { full_name: fullName } : {} } },
    error: null,
  })

beforeEach(() => {
  exchangeCodeForSession.mockReset()
  signOut.mockClear()
  ensureProfileForUser.mockReset()
})
afterEach(() => vi.clearAllMocks())

/**
 * Where a Google sign-in lands.
 *
 * Every redirect here is a bare path, not an absolute URL. On Vercel the host
 * a route handler sees is not always the host the browser asked for, so
 * building an absolute redirect means either trusting a forwarded header or
 * sending the user to an internal hostname. A relative Location is resolved by
 * the browser against the URL it actually requested, which removes the choice.
 */
describe('GET /auth/callback', () => {
  const locationOf = (res: Response) => res.headers.get('location')

  it('admits a firm Google account and sends it to the staff home', async () => {
    signedInAs('scott@aubreylegal.com', 'Scott Aubrey')
    ensureProfileForUser.mockResolvedValue('attorney')
    const res = await call('?code=abc')
    expect(locationOf(res)).toBe('/')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('honours a remembered destination the role may reach', async () => {
    signedInAs('scott@aubreylegal.com')
    ensureProfileForUser.mockResolvedValue('attorney')
    const res = await call('?code=abc&redirectTo=%2Freview')
    expect(locationOf(res)).toBe('/review')
  })

  it('ignores a destination that leaves this site', async () => {
    signedInAs('scott@aubreylegal.com')
    ensureProfileForUser.mockResolvedValue('attorney')
    const res = await call('?code=abc&redirectTo=https%3A%2F%2Fevil.example')
    expect(locationOf(res)).toBe('/')
  })

  /**
   * The consequential one. `ensure_user_profile` gives any address outside the
   * firm a client role, so without this check a stranger with any Google
   * account signs in and provisions themselves a portal account. There are no
   * client users yet, so nothing is lost by refusing and a real exposure is
   * closed. Client access will arrive as an invite tied to an intake.
   */
  it('refuses a Google account outside the firm, and does not leave it signed in', async () => {
    signedInAs('someone@gmail.com')
    ensureProfileForUser.mockResolvedValue('client')
    const res = await call('?code=abc')
    expect(signOut).toHaveBeenCalled()
    expect(locationOf(res)).toBe('/auth/login?error=firm_domain_required')
  })

  it('refuses an account whose role could not be established', async () => {
    signedInAs('scott@aubreylegal.com')
    ensureProfileForUser.mockResolvedValue(null)
    const res = await call('?code=abc')
    expect(signOut).toHaveBeenCalled()
    expect(locationOf(res)).toBe('/auth/login?error=no_role')
  })

  it('sends a request with no code back to the login page', async () => {
    const res = await call('')
    expect(locationOf(res)).toBe('/auth/login?error=auth_failed')
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('reports a failed exchange rather than pretending it worked', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: 'bad code' } })
    const res = await call('?code=stale')
    expect(locationOf(res)).toBe('/auth/login?error=auth_failed')
  })

  it('treats a thrown exchange as a failed sign-in', async () => {
    exchangeCodeForSession.mockRejectedValue(new Error('network'))
    const res = await call('?code=abc')
    expect(locationOf(res)).toBe('/auth/login?error=auth_failed')
  })

  it('refuses a session with no email, which cannot be checked against the domain', async () => {
    signedInAs(null)
    ensureProfileForUser.mockResolvedValue('attorney')
    const res = await call('?code=abc')
    expect(signOut).toHaveBeenCalled()
    expect(locationOf(res)).toBe('/auth/login?error=firm_domain_required')
  })

  it('redirects with 303, so the browser follows with GET', async () => {
    signedInAs('scott@aubreylegal.com')
    ensureProfileForUser.mockResolvedValue('attorney')
    expect((await call('?code=abc')).status).toBe(303)
  })
})
