import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), admin: null as unknown }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))

import { PATCH } from '@/app/api/admin/tasks/bulk/route'

/**
 * Reassigning a selection in one write.
 *
 * The queue spans every matter, so triage is a judgement made across rows. The
 * risks are all in the edges: a selection that has gone stale while it was
 * held, an id that is not an id, and an assignee who is not staff — writing an
 * arbitrary uuid into `assignee_id` would put a task in a queue belonging to
 * nobody, where it would never be seen again.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'

interface Call {
  table: string
  update?: Record<string, unknown>
  filters: Array<{ op: string; args: unknown[] }>
}

let calls: Call[]
let taskRows: Array<{ id: string }>
let taskError: { message: string } | null
let assigneeRow: { id: string; role: string } | null

function client() {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['in', 'eq']) {
        chain[op] = (...args: unknown[]) => {
          call.filters.push({ op, args })
          return chain
        }
      }
      chain.update = (values: Record<string, unknown>) => {
        call.update = values
        return chain
      }
      chain.select = () => chain
      chain.maybeSingle = async () => ({ data: assigneeRow, error: null })
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: taskRows, error: taskError }).then(resolve)
      return chain
    },
  }
}

const patch = (body: unknown) =>
  PATCH(
    new Request('http://test/api/admin/tasks/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

function taskCall() {
  return calls.find(c => c.table === 'tasks')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  mocks.admin = client()
  calls = []
  taskRows = [{ id: A }, { id: B }]
  taskError = null
  assigneeRow = { id: STAFF, role: 'attorney' }
})

describe('assigning a selection', () => {
  it('writes once for the whole selection', async () => {
    await patch({ ids: [A, B], assignee_id: STAFF })

    const filter = taskCall()?.filters.find(f => f.op === 'in')
    expect(filter?.args).toEqual(['id', [A, B]])
    expect(taskCall()?.update).toMatchObject({ assignee_id: STAFF })
  })

  it('reports how many rows it actually touched', async () => {
    const body = await (await patch({ ids: [A, B], assignee_id: STAFF })).json()

    expect(body.updated).toBe(2)
    expect(body.tasks).toHaveLength(2)
  })

  it('names the ids that matched nothing rather than quietly dropping them', async () => {
    // The selection is held client-side and can go stale — another tab
    // completes a task, the closeout sweep archives it.
    taskRows = [{ id: A }]

    const body = await (await patch({ ids: [A, B], assignee_id: STAFF })).json()

    expect(body.updated).toBe(1)
    expect(body.missing).toEqual([B])
  })

  it('collapses a selection that repeats an id', async () => {
    await patch({ ids: [A, A, B], assignee_id: STAFF })

    expect(taskCall()?.filters.find(f => f.op === 'in')?.args[1]).toEqual([A, B])
  })

  it('accepts null to hand the selection back to nobody', async () => {
    const res = await patch({ ids: [A], assignee_id: null })

    expect(res.status).toBe(200)
    expect(taskCall()?.update).toMatchObject({ assignee_id: null })
    // No lookup to do: unassigning cannot name a person who should not have it.
    expect(calls.some(c => c.table === 'users')).toBe(false)
  })
})

describe('who a task can be handed to', () => {
  it('checks the assignee is someone who takes firm work', async () => {
    await patch({ ids: [A], assignee_id: STAFF })

    const lookup = calls.find(c => c.table === 'users')
    expect(lookup?.filters.find(f => f.op === 'eq')?.args).toEqual(['id', STAFF])
  })

  it('refuses a client, who would never see the task again', async () => {
    assigneeRow = { id: STAFF, role: 'client' }

    const res = await patch({ ids: [A], assignee_id: STAFF })

    expect(res.status).toBe(400)
    expect(taskCall()).toBeUndefined()
  })

  it('refuses an id belonging to no one', async () => {
    assigneeRow = null

    const res = await patch({ ids: [A], assignee_id: STAFF })

    expect(res.status).toBe(400)
    expect(taskCall()).toBeUndefined()
  })
})

describe('what it refuses', () => {
  it('rejects an empty selection', async () => {
    expect((await patch({ ids: [], assignee_id: STAFF })).status).toBe(400)
    expect(taskCall()).toBeUndefined()
  })

  it('rejects the whole call when any id is not an id', async () => {
    // Not "skip the bad one": a selection that silently loses a row reports a
    // success the user cannot see is incomplete.
    const res = await patch({ ids: [A, 'not-a-uuid'], assignee_id: STAFF })

    expect(res.status).toBe(400)
    expect(taskCall()).toBeUndefined()
  })

  it('rejects a selection larger than the cap', async () => {
    const res = await patch({ ids: Array.from({ length: 201 }, () => A), assignee_id: STAFF })

    expect(res.status).toBe(400)
  })

  it('distinguishes an omitted assignee from an explicit null', async () => {
    // Omitting it is a malformed request; null is "unassign", and treating the
    // first as the second would wipe assignments on a bad client call.
    const res = await patch({ ids: [A] })

    expect(res.status).toBe(400)
    expect(taskCall()).toBeUndefined()
  })

  it('never writes without admin auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response('no', { status: 401 }) })

    expect((await patch({ ids: [A], assignee_id: STAFF })).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('surfaces a failed write', async () => {
    taskError = { message: 'permission denied' }

    const res = await patch({ ids: [A], assignee_id: STAFF })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('permission denied')
  })
})
