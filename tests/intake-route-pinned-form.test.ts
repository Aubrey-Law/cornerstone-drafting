import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: vi.fn() }))
vi.mock('@/lib/syncLeadFromIntake', () => ({ intakePayloadTouchesLead: () => false, syncLeadFromIntake: vi.fn() }))
vi.mock('@/lib/intakeSeed', () => ({ seedDesignSheetAndJobs: vi.fn(async () => {}) }))
vi.mock('@/lib/intakeContactHydration', async (original) => ({ ...await original<object>(), hydrateIntakeWithContacts: async (_db: unknown, row: unknown) => row }))
const state = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
  row: { id: 'intake', status: 'draft', form_version_id: 'pinned-1', intake_track: 'college_prep' } as Record<string, unknown>,
  version: vi.fn(),
}))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: state.version, getTemplateRow: async () => ({ key: 'custom_form' }) }))
vi.mock('@/lib/intake/standingLinks', () => ({ resolveIntakeByInviteToken: async () => state.row }))
vi.mock('@supabase/supabase-js', async () => ({ createClient: () => ({ ...getAdminClient(), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'staff@example.com', getAdminClient: () => ({ from: (table: string) => {
  let verb = 'select'
  let values: Record<string, unknown> = {}
  const result = () => { if (verb !== 'select') state.writes.push({ table, values }); return { data: table === 'client_intake' ? [state.row] : [], error: null } }
  const chain = {
    select: () => chain, eq: () => chain, or: () => chain,
    update: (value: Record<string, unknown>) => { verb = 'update'; values = value; return chain }, insert: (value: Record<string, unknown>) => { verb = 'insert'; values = value; return chain },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return chain
} }) }))
import { getAdminClient } from '@/lib/supabaseAdmin'


const definition = { schemaVersion: 1, key: 'custom_form', title: 'Custom form', sections: [
  { id: 'custom_identity', title: 'Custom identity', audience: 'client_and_staff', items: [{ kind: 'field', id: 'name', fieldId: 'client_first_name' }] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
beforeEach(() => {
  state.writes = []
  state.row = { id: 'intake', status: 'draft', form_version_id: 'pinned-1', intake_track: 'college_prep' }
  state.version.mockReset().mockResolvedValue({ status: 'published', template_id: 'template', definition })
  vi.stubEnv('INTAKE_RENDERER_MODE', 'legacy')
})
afterEach(() => vi.unstubAllEnvs())

async function submit(token: string | undefined, extra: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/intake/route')
  return POST(new Request('http://localhost/api/intake', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Intake-Token': token } : { Authorization: 'Bearer session' }) },
    body: JSON.stringify({ existingId: 'intake', status: 'submitted', ...extra }),
  }))
}
const submissionWrites = () => state.writes.filter(write => write.table === 'client_intake' && write.values.status === 'submitted')

describe.each([undefined, 'invite'])('pinned intake submission (%s)', token => {
  it('uses the stored version and track despite forged request metadata', async () => {
    const response = await submit(token, { form_version_id: 'forged', intake_track: 'estate' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ issues: [{ sectionId: 'custom_identity', message: "Enter the student's first name." }] })
    expect(state.version).toHaveBeenCalledWith('pinned-1')
    expect(submissionWrites()).toEqual([])
  })
  it('accepts hydrated persisted answers under the pinned custom requirements', async () => {
    state.row.first_name = 'Jordan'
    const response = await submit(token, { form_version_id: 'forged' })
    expect(response.status).toBe(200)
    expect(submissionWrites().length).toBeGreaterThan(0)
    expect(submissionWrites().every(write => !Object.hasOwn(write.values, 'form_version_id'))).toBe(true)
  })
  it('returns a safe unavailable response and does not submit when the pin cannot load', async () => {
    state.version.mockRejectedValue(new Error('private database detail'))
    const response = await submit(token, { first_name: 'Jordan' })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Intake validation is temporarily unavailable.' })
    expect(submissionWrites()).toEqual([])
  })
  it('preserves the submitted lock before resolving a version', async () => {
    state.row.status = 'submitted'
    const response = await submit(token)
    expect(response.status).toBe(409)
    expect(state.version).not.toHaveBeenCalled()
  })
})
