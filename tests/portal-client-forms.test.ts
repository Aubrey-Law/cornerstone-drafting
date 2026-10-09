import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * lib/forms/portalForms against a recording fake of the service-role client.
 * The point is the scoping: every read is narrowed to intakes the session user
 * owns, and a save needs both ownership and the current revision.
 */
type Call = { table: string; op: string; filters: [string, ...unknown[]][]; payload?: unknown }
const calls: Call[] = []
let handler: (call: Call) => { data: unknown; error: null | { message: string } }

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  const resolve = () => { calls.push(call); return Promise.resolve(handler(call)) }
  const chain: Record<string, unknown> = {}
  for (const name of ['eq', 'neq', 'in', 'or', 'order']) chain[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return chain }
  chain.select = () => chain
  chain.update = (payload: unknown) => { call.op = 'update'; call.payload = payload; return chain }
  chain.insert = (payload: unknown) => { call.op = 'insert'; call.payload = payload; return resolve() }
  chain.maybeSingle = resolve
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => resolve().then(onFulfilled, onRejected)
  return chain
}

vi.mock('@/lib/forms/database', () => ({ formsDb: () => ({ from: builder }) }))
vi.mock('@/lib/forms/matterForms', () => {
  class MatterFormsError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
  return {
    MatterFormsError,
    intakeDisplayName: (row: { first_name?: string | null }) => row.first_name ?? 'Client',
    compileClientFormVersion: async () => ({
      templateId: 't',
      form: { purpose: 'client_form', schemaVersion: 1, key: 'k', title: 'T', audience: 'client', sections: [{ id: 's', title: 'S', audience: 'client_and_staff', items: [
        { kind: 'question', id: 'q1', label: 'Which colleges?', questionType: 'long_text', options: [], required: true },
      ] }] },
    }),
  }
})

const USER = '11111111-1111-4111-8111-111111111111'
const OWNED = '22222222-2222-4222-8222-222222222222'
const FORM = '33333333-3333-4333-8333-333333333333'
const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: FORM, matter_id: 'm', client_intake_id: OWNED, form_version_id: 'v', title: 'Follow-up', status: 'sent',
  answers: {}, revision: 2, sent_by: null, sent_at: '2026-10-01T00:00:00Z', submitted_at: null, cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...overrides,
})

function world(row: Record<string, unknown> | null, updated: Record<string, unknown> | null = null) {
  handler = call => {
    if (call.table === 'client_intake') return { data: [{ id: OWNED, first_name: 'Sam', created_at: '2026-01-01' }], error: null }
    if (call.table === 'client_form_assignments' && call.op === 'select') return { data: row, error: null }
    if (call.table === 'client_form_assignments' && call.op === 'update') return { data: updated, error: null }
    return { data: null, error: null }
  }
}

beforeEach(() => { calls.length = 0 })

describe('portal client forms', () => {
  it('scopes reads to intakes owned by the session user', async () => {
    world(assignment())
    const { getPortalClientForm } = await import('@/lib/forms/portalForms')
    await getPortalClientForm(USER, FORM)
    const intakeRead = calls.find(call => call.table === 'client_intake')!
    expect(intakeRead.filters).toContainEqual(['or', `user_id.eq.${USER},client_user_id.eq.${USER}`])
    const formRead = calls.find(call => call.table === 'client_form_assignments')!
    expect(formRead.filters).toContainEqual(['in', 'client_intake_id', [OWNED]])
  })

  it('treats a form the user does not own, or one withdrawn, as not found', async () => {
    const { getPortalClientForm } = await import('@/lib/forms/portalForms')
    world(null)
    await expect(getPortalClientForm(USER, FORM)).rejects.toMatchObject({ status: 404 })
    world(assignment({ status: 'cancelled', cancelled_at: '2026-10-02T00:00:00Z' }))
    await expect(getPortalClientForm(USER, FORM)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to change a submitted form', async () => {
    world(assignment({ status: 'submitted', submitted_at: '2026-10-02T00:00:00Z' }))
    const { savePortalClientForm } = await import('@/lib/forms/portalForms')
    await expect(savePortalClientForm(USER, FORM, { revision: 2, answers: { q1: 'MIT' }, submit: false })).rejects.toMatchObject({ status: 409 })
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('will not submit with required answers missing', async () => {
    world(assignment())
    const { savePortalClientForm } = await import('@/lib/forms/portalForms')
    const result = await savePortalClientForm(USER, FORM, { revision: 2, answers: {}, submit: true })
    expect(result.ok).toBe(false)
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('saves against the caller revision and reports a stale one as a conflict', async () => {
    world(assignment(), assignment({ revision: 3, status: 'submitted', submitted_at: '2026-10-02T00:00:00Z' }))
    const { savePortalClientForm } = await import('@/lib/forms/portalForms')
    const saved = await savePortalClientForm(USER, FORM, { revision: 2, answers: { q1: 'MIT', stray: 'x' }, submit: true })
    expect(saved).toMatchObject({ ok: true, revision: 3, status: 'submitted' })
    const update = calls.find(call => call.op === 'update')!
    expect(update.filters).toContainEqual(['eq', 'revision', 2])
    expect(update.payload).toMatchObject({ answers: { q1: 'MIT' }, status: 'submitted' })
    expect(calls.some(call => call.table === 'matter_activity' && call.op === 'insert')).toBe(true)

    world(assignment(), null)
    await expect(savePortalClientForm(USER, FORM, { revision: 1, answers: { q1: 'MIT' }, submit: false })).rejects.toMatchObject({ status: 409 })
  })
})
