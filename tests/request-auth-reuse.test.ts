import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), role: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.role }) }) }) }) }))
vi.mock('@/lib/supabaseServer', () => ({ createServerSupabase: vi.fn() }))
import { requireAdmin } from '@/lib/apiAuth'
beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ data: { user: { id: 'user' } } })
  mocks.role.mockReset().mockResolvedValue({ data: { role: 'attorney' } })
})
function request() { return new Request('http://localhost', { headers: { authorization: 'Bearer synthetic' } }) }
it('shares verification only within the same Request object', async () => {
  const req = request()
  const [a, b] = await Promise.all([requireAdmin(req), requireAdmin(req)])
  expect(a.userId).toBe('user'); expect(b.userId).toBe('user')
  expect(mocks.user).toHaveBeenCalledTimes(1); expect(mocks.role).toHaveBeenCalledTimes(1)
  mocks.role.mockResolvedValue({ data: { role: 'client' } })
  expect((await requireAdmin(request())).err?.status).toBe(403)
  expect(mocks.role).toHaveBeenCalledTimes(2)
})
it('rejects expired bearer credentials', async () => {
  mocks.user.mockResolvedValue({ data: { user: null } })
  expect((await requireAdmin(request())).err?.status).toBe(401)
  expect(mocks.role).not.toHaveBeenCalled()
})
