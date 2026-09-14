import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), worksDb: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/works/data', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/works/data')>()),
  worksDb: mocks.worksDb,
}))

import { DELETE, PATCH } from '@/app/api/admin/works/[id]/route'

interface Call { table: string; op: string; filters: Record<string, unknown>; payload?: Record<string, unknown> }

/** Records every query and answers through one handler the test supplies. */
function stubDb(handle: (call: Call) => { data: unknown; error: unknown }, calls: Call[]) {
  return {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: {} }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.update = (payload: Record<string, unknown>) => { call.op = 'update'; call.payload = payload; return chain }
      chain.insert = (payload: Record<string, unknown>) => { call.op = 'insert'; call.payload = payload; return chain }
      chain.delete = () => { call.op = 'delete'; return chain }
      chain.eq = (column: string, value: unknown) => { call.filters[column] = value; return chain }
      chain.order = () => chain
      chain.limit = () => chain
      const settle = () => { calls.push(call); return handle(call) }
      chain.maybeSingle = async () => settle()
      chain.single = async () => settle()
      chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(settle()).then(onFulfilled)
      return chain
    },
  }
}

const OWNER = 'owner-1'
const OTHER = 'other-1'
const SKILL = {
  id: 'skill-1',
  owner_id: OWNER,
  is_system: false,
  is_active: true,
  name: 'Thing',
  skill_md: '---\nname: Thing\ndescription: d\nversion: 1\ntype: assistant\nexecution_mode: run\n---\nbody',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/admin/works/skill-1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'skill-1' }) },
  )
}

function asUser(userId: string, email = 'a@b.c') {
  mocks.requireAdmin.mockResolvedValue({ err: null, userId, user: { id: userId, email } })
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser(OWNER)
})

describe('editing a skill', () => {
  it('refuses an attorney who neither owns it nor was granted edit', async () => {
    asUser(OTHER)
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.table === 'work_skill_shares') return { data: null, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    const response = await patch({ isActive: false })

    expect(response.status).toBe(403)
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  // allow_edit was written by the share endpoint, returned on the row, and then
  // ignored by this gate — the dialog even told the user to grant it "from the API".
  it('honors an explicit edit grant', async () => {
    asUser(OTHER, 'shared@example.com')
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.table === 'work_skill_shares') return { data: { allow_edit: true }, error: null }
      if (call.op === 'update') return { data: { ...SKILL, is_active: false }, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    const response = await patch({ isActive: false, expectedUpdatedAt: SKILL.updated_at })

    expect(response.status).toBe(200)
    expect(calls.some(call => call.op === 'update')).toBe(true)
  })

  it('refuses a share that did not grant edit', async () => {
    asUser(OTHER, 'shared@example.com')
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.table === 'work_skill_shares') return { data: { allow_edit: false }, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    expect((await patch({ isActive: false })).status).toBe(403)
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('never lets a system skill be edited, even by its owner row', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(() => ({ data: { ...SKILL, is_system: true }, error: null }), calls) as never)
    expect((await patch({ isActive: false })).status).toBe(403)
  })
})

describe('two attorneys editing the same skill', () => {
  it('rejects a write built on a version that has moved on', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(() => ({ data: SKILL, error: null }), calls) as never)

    const response = await patch({ skillMd: SKILL.skill_md, expectedUpdatedAt: '2025-01-01T00:00:00.000Z' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('changed') })
    expect(calls.some(call => call.op === 'update')).toBe(false)
  })

  it('scopes the update to the version it read, so a concurrent write cannot be lost', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.op === 'update') return { data: SKILL, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    await patch({ isActive: false, expectedUpdatedAt: SKILL.updated_at })

    const update = calls.find(call => call.op === 'update')
    expect(update?.filters).toMatchObject({ id: 'skill-1', updated_at: SKILL.updated_at })
  })

  it('reports a lost race as a conflict rather than a 500', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      // PostgREST returns no row when the guarded update matches nothing.
      if (call.op === 'update') return { data: null, error: { message: 'no rows' } }
      return { data: SKILL, error: null }
    }, calls) as never)

    expect((await patch({ isActive: false, expectedUpdatedAt: SKILL.updated_at })).status).toBe(409)
  })
})

describe('deleting a skill', () => {
  it('is owner-only, and an edit grant is not enough', async () => {
    asUser(OTHER, 'shared@example.com')
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.table === 'work_skill_shares') return { data: { allow_edit: true }, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    const response = await DELETE(
      new Request('http://localhost/api/admin/works/skill-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'skill-1' }) },
    )

    expect(response.status).toBe(403)
    expect(calls.some(call => call.op === 'delete')).toBe(false)
  })
})

describe('an overwritten skill is recoverable', () => {
  it('records the previous text before replacing it', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(call => {
      if (call.op === 'update') return { data: SKILL, error: null }
      return { data: SKILL, error: null }
    }, calls) as never)

    const edited = SKILL.skill_md.replace('body', 'a different body')
    await patch({ skillMd: edited, expectedUpdatedAt: SKILL.updated_at })

    const revision = calls.find(call => call.table === 'work_skill_revisions')
    expect(revision?.op).toBe('insert')
    expect(revision?.payload).toMatchObject({ skill_id: 'skill-1', skill_md: SKILL.skill_md })
  })

  it('does not record a revision when the text did not change', async () => {
    const calls: Call[] = []
    mocks.worksDb.mockReturnValue(stubDb(() => ({ data: SKILL, error: null }), calls) as never)

    await patch({ isActive: false, expectedUpdatedAt: SKILL.updated_at })

    expect(calls.some(call => call.table === 'work_skill_revisions')).toBe(false)
  })
})
