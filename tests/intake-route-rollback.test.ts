import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/intake/forms/definitions', () => { throw new Error('Broken compiled definitions') })
vi.mock('@/lib/intake/forms/evaluator', () => { throw new Error('Broken compiled evaluator') })
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: vi.fn() }))
vi.mock('@/lib/syncLeadFromIntake', () => ({ intakePayloadTouchesLead: () => false, syncLeadFromIntake: vi.fn() }))
vi.mock('@/lib/intakeSeed', () => ({ seedDesignSheetAndJobs: vi.fn(async () => {}) }))
vi.mock('@/lib/intakeContactHydration', async (original) => ({ ...await original<object>(), hydrateIntakeWithContacts: async (_db: unknown, row: unknown) => row }))
const state = vi.hoisted(() => ({ writes: [] as string[], row: { id: 'intake', status: 'draft', first_name: 'Jane', last_name: 'Example', email: 'jane@example.com', phone: '(617) 555-0111' } }))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: async () => state.row }))
vi.mock('@supabase/supabase-js', async () => ({ createClient: () => ({ ...getAdminClient(), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'staff@example.com', getAdminClient: () => ({ from: (table: string) => {
  let verb = 'select'
  const result = () => { if (verb !== 'select') state.writes.push(`${table}:${verb}`); return { data: table === 'client_intake' ? [state.row] : [], error: null } }
  const chain = {
    select: () => chain, eq: () => chain, or: () => chain,
    update: () => { verb = 'update'; return chain }, insert: () => { verb = 'insert'; return chain },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return chain
} }) }))
import { getAdminClient } from '@/lib/supabaseAdmin'

afterEach(() => { vi.unstubAllEnvs(); state.writes = [] })
describe.each([undefined, 'invite'])('API rollback (%s)', (token) => {
  it.each(['draft', 'submitted'])('imports and handles legacy %s without compiled initialization', async (status) => {
    vi.stubEnv('INTAKE_RENDERER_MODE', 'legacy')
    const { POST } = await import('@/app/api/intake/route')
    const response = await POST(new Request('http://localhost/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Intake-Token': token } : { Authorization: 'Bearer session' }) }, body: JSON.stringify({ ...state.row, existingId: 'intake', status, id: undefined }) }))
    expect(response.status).toBe(200)
    expect(state.writes).toContain('client_intake:update')
  })
  it('fails closed in compiled mode when production selectors cannot initialize', async () => {
    vi.stubEnv('INTAKE_RENDERER_MODE', 'compiled')
    const { POST } = await import('@/app/api/intake/route')
    const response = await POST(new Request('http://localhost/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Intake-Token': token } : { Authorization: 'Bearer session' }) }, body: JSON.stringify({ existingId: 'intake', status: 'submitted' }) }))
    expect(response.status).toBe(503)
    expect(state.writes).toEqual([])
  })
})
