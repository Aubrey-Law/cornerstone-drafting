import { describe, expect, it, vi } from 'vitest'

// vi.hoisted: the mock factory is lifted above the imports, so the spy has to
// be created up there too rather than read from a module-level const.
const { getSessionUser } = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ getSessionUser }))

import { requireStaff } from '@/lib/auth/requireStaff'

/**
 * The proxy already gates `/api/staff/*`, and this is the second lock on the
 * same door. The matcher is a list a person maintains; a route that also checks
 * for itself cannot be exposed by an edit to that list.
 */
describe('requireStaff', () => {
  it('admits an attorney', async () => {
    getSessionUser.mockResolvedValue({ id: 'u-1', email: 'a@b.co', role: 'attorney' })
    const result = await requireStaff()
    expect(result.error).toBeNull()
    expect(result.user?.id).toBe('u-1')
  })

  it('admits an admin', async () => {
    getSessionUser.mockResolvedValue({ id: 'u-2', email: 'a@b.co', role: 'admin' })
    expect((await requireStaff()).error).toBeNull()
  })

  it('answers 401 JSON for an anonymous caller', async () => {
    getSessionUser.mockResolvedValue(null)
    const { error } = await requireStaff()
    expect(error?.status).toBe(401)
    expect(await error?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('answers 403 JSON for a signed-in client', async () => {
    getSessionUser.mockResolvedValue({ id: 'u-3', email: 'c@b.co', role: 'client' })
    const { error } = await requireStaff()
    expect(error?.status).toBe(403)
    expect(await error?.json()).toEqual({ error: 'Forbidden' })
  })
})
