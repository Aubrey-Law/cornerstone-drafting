import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A staff user signing in from the Word add-in has never touched `/auth/login`
 * or `/auth/callback`, so nothing has ever run `ensureUserProfile` for them:
 * the pane's dialog talks to Supabase directly. They arrive at every
 * `/api/addin/*` route authenticated and roleless, and used to be met with a
 * bare 403 whose only fix — "open the Cornerstone web app once first" — is not
 * something a pushed add-in can ask of an attorney.
 *
 * The bearer branch of `requireAdmin` now bootstraps the profile itself.
 */
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  adminRole: vi.fn(),
  scopedRole: vi.fn(),
  rpc: vi.fn(),
}))

// The caller's own token-scoped client: `getUser`, the profile read that
// `ensureUserProfile` does first, and the SECURITY DEFINER bootstrap itself.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.scopedRole }) }) }),
    rpc: mocks.rpc,
  }),
}))
// The service-role client behind `resolveUserRole`.
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.adminRole }) }) }),
  }),
}))
vi.mock('@/lib/supabaseServer', () => ({ createServerSupabase: vi.fn() }))

import { requireAdmin } from '@/lib/apiAuth'

/** A fresh Request each time: `requireAdmin` memoises per Request object. */
function request() {
  return new Request('http://localhost', { headers: { authorization: 'Bearer synthetic' } })
}

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({
    data: { user: { id: 'user', email: 'attorney@aubreylegal.com', user_metadata: {} } },
  })
  // No `public.users` row yet — the first-run state, from both clients' view.
  mocks.adminRole.mockReset().mockResolvedValue({ data: null })
  mocks.scopedRole.mockReset().mockResolvedValue({ data: null })
  mocks.rpc.mockReset().mockResolvedValue({ data: 'attorney', error: null })
})

describe('first run from the Word add-in', () => {
  it('provisions the missing profile instead of returning 403', async () => {
    const auth = await requireAdmin(request())

    expect(auth.err).toBeNull()
    expect(auth.userId).toBe('user')
    expect(mocks.rpc).toHaveBeenCalledWith('ensure_user_profile', expect.anything())
  })

  it('cannot be used to self-elevate', async () => {
    // The RPC derives the role from the confirmed address on `auth.users`, so a
    // caller outside the firm is provisioned as 'client' however they present
    // themselves — and 'client' is not an admin role.
    mocks.rpc.mockResolvedValue({ data: 'client', error: null })

    expect((await requireAdmin(request())).err?.status).toBe(403)
  })

  it('still refuses a caller the bootstrap cannot place', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'no session' } })

    expect((await requireAdmin(request())).err?.status).toBe(403)
  })

  it('does not write on every request once the profile exists', async () => {
    mocks.adminRole.mockResolvedValue({ data: { role: 'attorney' } })

    const auth = await requireAdmin(request())

    expect(auth.err).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('leaves an expired token as a 401, with no profile written', async () => {
    mocks.user.mockResolvedValue({ data: { user: null } })

    expect((await requireAdmin(request())).err?.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
