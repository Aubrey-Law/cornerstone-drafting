import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; verb: string; filters: Array<[string, unknown]> }
const state = vi.hoisted(() => ({
  calls: [] as Call[],
  roleDeleteError: null as { message: string } | null,
  contactSelectError: null as { message: string } | null,
  additionalDeleteError: null as { message: string } | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } }) }))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: async () => ({ id: 'intake-1', status: 'draft', user_id: null, client_user_id: null }) }))
vi.mock('@/lib/contacts/attachContactToMatter', () => ({ attachContactToMatter: vi.fn(async () => undefined), matterIdForIntake: async () => 'matter-1' }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const call: Call = { table, verb: 'select', filters: [] }
  state.calls.push(call)
  const result = () => {
    if (table === 'contact_roles' && call.verb === 'delete') return { data: null, error: state.roleDeleteError }
    if (table === 'contacts' && call.verb === 'delete') return { data: null, error: state.additionalDeleteError }
    if (table === 'contacts' && call.verb === 'select') return { data: [{ id: 'contact-1', first_name: 'Pat', last_name: 'Example' }], error: state.contactSelectError }
    return { data: [], error: null }
  }
  const chain = {
    select: () => chain,
    delete: () => { call.verb = 'delete'; return chain },
    insert: () => { call.verb = 'insert'; return chain },
    update: () => { call.verb = 'update'; return chain },
    eq: (key: string, value: unknown) => { call.filters.push([key, value]); return chain },
    or: () => chain,
    maybeSingle: async () => ({ data: { id: 'intake-1' }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return chain
} }) }))
import { POST } from '@/app/api/intake/contacts/route'

const nominee = { first_name: 'Pat', last_name: 'Example', priority: 1 }
function request(action: 'save_fiduciaries' | 'save_additional_contacts', entries: unknown[], publicToken?: string) {
  return new Request('http://localhost/api/intake/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(publicToken ? { 'X-Intake-Token': publicToken } : { Authorization: 'Bearer session-1' }) }, body: JSON.stringify({ action, intakeId: 'intake-1', ...(action === 'save_fiduciaries' ? { entries, role: 'poa', forParty: 'client' } : { contacts: entries }) }) })
}
beforeEach(() => { state.calls = []; state.roleDeleteError = null; state.contactSelectError = null; state.additionalDeleteError = null })

describe.each([undefined, 'invite-1'])('contact replacement database errors (%s)', (publicToken) => {
  it.each([{ entries: [] }, { entries: [nominee] }])('rejects failed fiduciary DELETE for replacement %j before writing nominees', async ({ entries }) => {
    state.roleDeleteError = { message: 'role deletion failed' }
    const response = await POST(request('save_fiduciaries', entries, publicToken))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'role deletion failed' })
    expect(state.calls.filter((call) => call.verb === 'insert' || call.verb === 'update')).toEqual([])
  })
  it('rejects failed related-contact SELECT before writing contacts or roles', async () => {
    state.contactSelectError = { message: 'contact read failed' }
    const response = await POST(request('save_fiduciaries', [nominee], publicToken))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'contact read failed' })
    expect(state.calls.filter((call) => call.verb === 'insert' || call.verb === 'update')).toEqual([])
  })
  it.each([{ entries: [] }, { entries: [nominee] }])('rejects failed additional-contact DELETE for replacement %j before inserting contacts', async ({ entries }) => {
    state.additionalDeleteError = { message: 'additional deletion failed' }
    const response = await POST(request('save_additional_contacts', entries, publicToken))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'additional deletion failed' })
    expect(state.calls.filter((call) => call.verb === 'insert')).toEqual([])
  })
  it('acknowledges an empty fiduciary replacement only after the scoped DELETE succeeds', async () => {
    expect((await POST(request('save_fiduciaries', [], publicToken))).status).toBe(200)
    expect(state.calls.filter((call) => call.table === 'contact_roles')).toEqual([{ table: 'contact_roles', verb: 'delete', filters: [['client_intake_id', 'intake-1'], ['role', 'poa'], ['for_party', 'client']] }])
    expect(state.calls.some((call) => call.table === 'contacts')).toBe(false)
  })
  it('acknowledges an empty additional-contact replacement only after its scoped DELETE succeeds', async () => {
    expect((await POST(request('save_additional_contacts', [], publicToken))).status).toBe(200)
    const deletes = state.calls.filter((call) => call.table === 'contacts')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].verb).toBe('delete')
    expect(deletes[0].filters).toContainEqual(['client_intake_id', 'intake-1'])
    expect(deletes[0].filters.some(([key]) => key === 'source')).toBe(true)
  })
})
