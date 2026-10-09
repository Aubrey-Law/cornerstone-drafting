import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openCollegePrepCompanionMatter } from '@/lib/forms/collegePrepCompanion'
import { companionDraftBlocker } from '@/components/forms/MatterFormsCard'

/**
 * lib/forms/collegePrepCompanion against a recording fake of the service-role
 * client. The companion matter is hired through createMatterFromIntake (the
 * normal conversion path), so drafting sees an ordinary College Prep matter;
 * these tests pin the gates in front of it and the cross-link written after.
 */
type Call = { table: string; op: string; filters: [string, ...unknown[]][]; payload?: unknown }
const calls: Call[] = []
let tables: Record<string, Record<string, unknown> | null> = {}

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  const resolve = () => {
    calls.push(call)
    if (call.op === 'update') return Promise.resolve({ data: null, error: tables.updateError ? { message: 'boom' } : null })
    return Promise.resolve({ data: tables[table] ?? null, error: null })
  }
  const chain: Record<string, unknown> = {}
  for (const name of ['eq', 'in', 'order']) chain[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return chain }
  chain.select = () => chain
  chain.update = (payload: unknown) => { call.op = 'update'; call.payload = payload; return chain }
  chain.maybeSingle = resolve
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => resolve().then(onFulfilled, onRejected)
  return chain
}

const createMatterFromIntake = vi.fn()
const logMatterActivity = vi.fn(async () => {})
vi.mock('@/lib/forms/database', () => ({ formsDb: () => ({ from: builder }) }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ admin: true }) }))
vi.mock('@/lib/matters/createFromIntake', () => ({ createMatterFromIntake: (...args: unknown[]) => createMatterFromIntake(...args) }))
vi.mock('@/lib/forms/matterForms', () => {
  class MatterFormsError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
  return {
    MatterFormsError,
    intakeDisplayName: (row: { first_name?: string | null }) => row.first_name ?? 'Client',
    logMatterActivity: (...args: unknown[]) => logMatterActivity(...(args as [])),
  }
})


const PARENT = 'parent-matter'
const LINK = 'link-1'
const STUDENT = 'student-intake'
const COMPANION = 'companion-matter'

function world(overrides: { link?: Record<string, unknown> | null; parent?: Record<string, unknown>; intake?: Record<string, unknown>; updateError?: boolean } = {}) {
  tables = {
    matter_linked_intakes: overrides.link === undefined
      ? { id: LINK, matter_id: PARENT, client_intake_id: STUDENT, label: 'Student', companion_matter_id: null }
      : overrides.link,
    matters: { id: PARENT, name: 'Pat Smith — Estate Planning', matter_number: '2026-EP-SMITH', relationship_status: 'hired', ...overrides.parent },
    client_intake: { id: STUDENT, first_name: 'Alex', last_name: 'Smith', intake_track: 'college_prep', status: 'submitted', ...overrides.intake },
    updateError: overrides.updateError ? {} : null,
  }
}

async function rejection(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error as Error & { status: number } }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  calls.length = 0
  createMatterFromIntake.mockReset()
  logMatterActivity.mockClear()
  createMatterFromIntake.mockResolvedValue({ ok: true, matterId: COMPANION, matterNumber: '2026-CP-SMITH' })
})

describe('opening a College Prep companion matter', () => {
  it('hires the student intake through the normal conversion path and cross-links it', async () => {
    world()
    const result = await openCollegePrepCompanionMatter(PARENT, LINK, 'actor')
    expect(createMatterFromIntake).toHaveBeenCalledWith({ admin: true }, STUDENT, { actorId: 'actor' })
    expect(result).toEqual({ matterId: COMPANION, matterNumber: '2026-CP-SMITH', created: true, draftingPath: `/admin/drafting/${COMPANION}` })
    const update = calls.find(call => call.op === 'update')
    expect(update).toMatchObject({ table: 'matter_linked_intakes', payload: { companion_matter_id: COMPANION }, filters: [['eq', 'id', LINK]] })
    expect(logMatterActivity).toHaveBeenCalledWith(PARENT, 'actor', 'college_prep_companion_opened', 'College Prep package opened for Alex', '2026-CP-SMITH')
    expect(logMatterActivity).toHaveBeenCalledWith(COMPANION, 'actor', 'college_prep_companion_opened', expect.any(String), '2026-EP-SMITH · Pat Smith — Estate Planning')
  })

  it('scopes the link to the matter in the URL', async () => {
    world({ link: null })
    expect((await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))).status).toBe(404)
    const linkRead = calls.find(call => call.table === 'matter_linked_intakes')!
    expect(linkRead.filters).toEqual([['eq', 'id', LINK], ['eq', 'matter_id', PARENT]])
    expect(createMatterFromIntake).not.toHaveBeenCalled()
  })

  it('returns the existing companion without hiring again', async () => {
    world({ link: { id: LINK, matter_id: PARENT, client_intake_id: STUDENT, companion_matter_id: COMPANION } })
    tables.matters = { id: COMPANION, matter_number: '2026-CP-SMITH' }
    const result = await openCollegePrepCompanionMatter(PARENT, LINK, 'actor')
    expect(result).toMatchObject({ matterId: COMPANION, created: false, draftingPath: `/admin/drafting/${COMPANION}` })
    expect(createMatterFromIntake).not.toHaveBeenCalled()
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('requires the family matter to be hired', async () => {
    world({ parent: { relationship_status: 'opportunity' } })
    const error = await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))
    expect(error.status).toBe(409)
    expect(error.message).toMatch(/Hire this matter/)
    expect(createMatterFromIntake).not.toHaveBeenCalled()
  })

  it('only drafts a submitted College Prep questionnaire', async () => {
    world({ intake: { intake_track: 'estate' } })
    expect((await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))).status).toBe(422)
    world({ intake: { status: 'in_progress' } })
    const unsubmitted = await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))
    expect(unsubmitted.status).toBe(409)
    expect(unsubmitted.message).toMatch(/submitted/)
    expect(createMatterFromIntake).not.toHaveBeenCalled()

    world({ intake: { status: 'approved' } })
    await expect(openCollegePrepCompanionMatter(PARENT, LINK, 'actor')).resolves.toMatchObject({ matterId: COMPANION })
  })

  it('surfaces a blocked hire (e.g. a recorded conflict) without cross-linking', async () => {
    world()
    createMatterFromIntake.mockResolvedValue({ ok: false, error: 'A conflict of interest is recorded on this lead.' })
    const error = await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))
    expect(error).toMatchObject({ status: 409, message: 'A conflict of interest is recorded on this lead.' })
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('reports a failed cross-link so a retry can finish it', async () => {
    world({ updateError: true })
    const error = await rejection(openCollegePrepCompanionMatter(PARENT, LINK, 'actor'))
    expect(error.status).toBe(500)
    expect(logMatterActivity).not.toHaveBeenCalled()
  })
})

describe('the Forms card draft button', () => {
  it('explains why a linked College Prep questionnaire cannot be drafted yet', () => {
    const intake = {
      id: STUDENT, primary: false, linkId: LINK, label: 'Student', name: 'Alex Smith', email: 'a@example.com', track: 'college_prep' as const,
      status: 'submitted', sentAt: null, completedAt: null, hasPortalAccount: true, companionMatter: null,
    }
    expect(companionDraftBlocker(intake, true)).toBeNull()
    expect(companionDraftBlocker(intake, false)).toBe('Hire this matter first')
    expect(companionDraftBlocker({ ...intake, status: 'in_progress' }, true)).toMatch(/submitted/)
    expect(companionDraftBlocker({ ...intake, track: 'estate' }, false)).toBeNull()
  })
})
