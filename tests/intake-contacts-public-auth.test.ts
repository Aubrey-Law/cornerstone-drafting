import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), children: vi.fn(async () => undefined),
  user: vi.fn<() => Promise<{ data: { user: { id: string } | null } }>>(async () => ({ data: { user: { id: 'user-1' } } })),
  owned: vi.fn(async () => ({ data: { id: 'intake-1' }, error: null })),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: mocks.resolve }))
vi.mock('@/lib/contacts/reconcileHouseholdChildren', () => ({ reconcileHouseholdChildren: mocks.children }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: () => {
  const chain = { select: () => chain, eq: () => chain, or: () => chain, maybeSingle: mocks.owned }
  return chain
} }) }))
import { POST } from '@/app/api/intake/contacts/route'
const draft = { id: 'intake-1', status: 'draft', user_id: null, client_user_id: null }
function request(token?: string, bearer?: string) {
  return new Request('http://localhost/api/intake/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Intake-Token': token } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ action: 'save_children', intakeId: 'intake-1', children: [{ first_name: 'Jane' }] }) })
}
beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue(draft); mocks.children.mockResolvedValue(undefined) })
describe('public contacts write authorization', () => {
  it('rejects missing authentication', async () => { expect((await POST(request())).status).toBe(401); expect(mocks.children).not.toHaveBeenCalled() })
  it('retains bearer authentication before parsing an untrusted body', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } })
    const req = new Request('http://localhost/api/intake/contacts', { method: 'POST', headers: { Authorization: 'Bearer expired' }, body: 'invalid JSON' })
    expect((await POST(req)).status).toBe(401)
    expect(mocks.children).not.toHaveBeenCalled()
  })
  it.each([null, { ...draft, id: 'other' }, { ...draft, user_id: 'user' }, { ...draft, client_user_id: 'user' }])('rejects invalid, other-intake, or registered tokens (%j)', async (row) => {
    mocks.resolve.mockResolvedValue(row)
    expect((await POST(request('invite-1'))).status).toBe(401)
    expect(mocks.children).not.toHaveBeenCalled()
  })
  it.each(['submitted', 'approved'])('rejects a %s token intake', async (status) => {
    mocks.resolve.mockResolvedValue({ ...draft, status })
    expect((await POST(request('invite-1'))).status).toBe(409)
    expect(mocks.children).not.toHaveBeenCalled()
  })
  it('persists only the invite-scoped household', async () => {
    expect((await POST(request('invite-1'))).status).toBe(200)
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), 'invite-1')
    expect(mocks.children).toHaveBeenCalledWith(expect.anything(), 'intake-1', [{ first_name: 'Jane' }])
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.owned).not.toHaveBeenCalled()
  })
  it('reports domain persistence failure', async () => {
    mocks.children.mockRejectedValueOnce(new Error('offline'))
    expect((await POST(request('invite-1'))).status).toBe(500)
  })
  it('does not allow a public invite to invoke unrelated contact actions', async () => {
    const req = new Request('http://localhost/api/intake/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intake-Token': 'invite-1' }, body: JSON.stringify({ action: 'upsert_contact', intakeId: 'intake-1' }) })
    expect((await POST(req)).status).toBe(403)
    expect(mocks.children).not.toHaveBeenCalled()
  })
  it('preserves the existing owned bearer path', async () => {
    expect((await POST(request(undefined, 'session-1'))).status).toBe(200)
    expect(mocks.user).toHaveBeenCalled()
    expect(mocks.owned).toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
