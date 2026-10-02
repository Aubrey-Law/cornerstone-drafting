import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), admin: null as unknown }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))

import { DELETE, PATCH } from '@/app/api/admin/tasks/bulk/route'
import { snoozedDueAt } from '@/lib/tasks/snooze'

/**
 * Snoozing and deleting a selection.
 *
 * Snooze moves each row from its own date — the same date the row menu would
 * land on — so a selection is N row updates, not one. Delete leaves stage
 * tasks alone: the stage engine owns them and would upsert them straight back.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

interface Row {
  id: string
  status?: string
  source?: string
  due_at: string | null
  soft_due_at: string | null
}

interface Call {
  table: string
  op: 'select' | 'update' | 'delete'
  update?: Record<string, unknown>
  filters: Array<{ op: string; args: unknown[] }>
}

let calls: Call[]
let rows: Row[]
let failUpdateFor: string | null
let deleteError: { message: string } | null

function client() {
  return {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['in', 'eq']) {
        chain[op] = (...args: unknown[]) => {
          call.filters.push({ op, args })
          return chain
        }
      }
      chain.select = () => chain
      chain.update = (values: Record<string, unknown>) => {
        call.op = 'update'
        call.update = values
        return chain
      }
      chain.delete = () => {
        call.op = 'delete'
        return chain
      }
      const idFilter = () => {
        const eq = call.filters.find(f => f.op === 'eq' && f.args[0] === 'id')
        if (eq) return [eq.args[1] as string]
        const inn = call.filters.find(f => f.op === 'in' && f.args[0] === 'id')
        return (inn?.args[1] as string[]) ?? []
      }
      chain.maybeSingle = async () => {
        const [id] = idFilter()
        if (id === failUpdateFor) return { data: null, error: { message: 'boom' } }
        const row = rows.find(r => r.id === id)
        return { data: row ? { ...row, ...call.update } : null, error: null }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const ids = idFilter()
        if (call.op === 'delete' && deleteError) {
          return Promise.resolve({ data: null, error: deleteError }).then(resolve)
        }
        return Promise.resolve({ data: rows.filter(r => ids.includes(r.id)), error: null }).then(resolve)
      }
      return chain
    },
  }
}

const send = (handler: typeof PATCH, method: string, body: unknown) =>
  handler(
    new Request('http://test/api/admin/tasks/bulk', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const updates = () => calls.filter(c => c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  mocks.admin = client()
  calls = []
  failUpdateFor = null
  deleteError = null
  rows = [
    { id: A, status: 'open', source: 'manual', due_at: '2026-10-01T15:00:00.000Z', soft_due_at: null },
    { id: B, status: 'open', source: 'stage', due_at: null, soft_due_at: '2026-10-05T13:30:00.000Z' },
  ]
})

describe('snoozing a selection', () => {
  it('moves each row from its own date, keeping the time of day', async () => {
    const res = await send(PATCH, 'PATCH', { ids: [A, B], snooze_days: 3 })

    expect(res.status).toBe(200)
    const byId = Object.fromEntries(
      updates().map(c => [c.filters.find(f => f.op === 'eq')?.args[1], c.update?.due_at]),
    )
    expect(byId[A]).toBe('2026-10-04T15:00:00.000Z')
    expect(byId[B]).toBe('2026-10-08T13:30:00.000Z')
  })

  it('lands where the row menu would', async () => {
    await send(PATCH, 'PATCH', { ids: [A], snooze_days: 7 })

    expect(updates()[0].update?.due_at).toBe(snoozedDueAt(rows[0], 7))
  })

  it('leaves finished tasks alone and says so', async () => {
    rows[0].status = 'done'

    const body = await (await send(PATCH, 'PATCH', { ids: [A, B], snooze_days: 1 })).json()

    expect(body.skipped).toEqual([A])
    expect(body.updated).toBe(1)
    expect(updates().map(c => c.filters.find(f => f.op === 'eq')?.args[1])).toEqual([B])
  })

  it('names ids that matched nothing', async () => {
    const body = await (await send(PATCH, 'PATCH', { ids: [A, C], snooze_days: 1 })).json()

    expect(body.missing).toEqual([C])
  })

  it('reports a row whose write failed without losing the rest', async () => {
    failUpdateFor = B

    const body = await (await send(PATCH, 'PATCH', { ids: [A, B], snooze_days: 1 })).json()

    expect(body.updated).toBe(1)
    expect(body.failed).toEqual([B])
  })

  it.each([0, -1, 1.5, '3', 366])('rejects snooze_days of %p', async days => {
    const res = await send(PATCH, 'PATCH', { ids: [A], snooze_days: days })

    expect(res.status).toBe(400)
    expect(updates()).toEqual([])
  })

  it('refuses a request that both assigns and snoozes', async () => {
    const res = await send(PATCH, 'PATCH', { ids: [A], snooze_days: 1, assignee_id: null })

    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('deleting a selection', () => {
  it('deletes the selection in one write', async () => {
    const body = await (await send(DELETE, 'DELETE', { ids: [A] })).json()

    const del = calls.find(c => c.op === 'delete')
    expect(del?.filters.find(f => f.op === 'in')?.args).toEqual(['id', [A]])
    expect(body.deleted).toEqual([A])
  })

  it('keeps stage tasks, which the stage engine would recreate', async () => {
    const body = await (await send(DELETE, 'DELETE', { ids: [A, B] })).json()

    const del = calls.find(c => c.op === 'delete')
    expect(del?.filters.find(f => f.op === 'in')?.args[1]).toEqual([A])
    expect(body.protected).toEqual([B])
    expect(body.deleted).toEqual([A])
  })

  it('dismisses generated tasks instead of deleting them, so their sweep does not write them back', async () => {
    rows.push({ id: C, status: 'open', source: 'fiduciary', due_at: null, soft_due_at: null })

    const body = await (await send(DELETE, 'DELETE', { ids: [A, C] })).json()

    const del = calls.find(c => c.op === 'delete')
    expect(del?.filters.find(f => f.op === 'in')?.args[1]).toEqual([A])
    const dismiss = calls.find(c => c.op === 'update')
    expect(dismiss?.filters.find(f => f.op === 'in')?.args[1]).toEqual([C])
    expect(dismiss?.update).toMatchObject({ status: 'archived', closeout_reason: null })
    expect(dismiss?.update?.skipped_at).toEqual(expect.any(String))
    // Both are gone from the queue as far as the user is concerned.
    expect(body.deleted.sort()).toEqual([A, C].sort())
    expect(body.dismissed).toEqual([C])
  })

  it('does not write at all when only stage tasks are selected', async () => {
    const body = await (await send(DELETE, 'DELETE', { ids: [B] })).json()

    expect(calls.some(c => c.op === 'delete')).toBe(false)
    expect(body.deleted_count).toBe(0)
  })

  it('names ids that were already gone', async () => {
    const body = await (await send(DELETE, 'DELETE', { ids: [A, C] })).json()

    expect(body.missing).toEqual([C])
  })

  it('rejects the whole call when any id is not an id', async () => {
    const res = await send(DELETE, 'DELETE', { ids: [A, 'nope'] })

    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('never deletes without admin auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response('no', { status: 401 }) })

    expect((await send(DELETE, 'DELETE', { ids: [A] })).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('surfaces a failed delete', async () => {
    deleteError = { message: 'permission denied' }

    const res = await send(DELETE, 'DELETE', { ids: [A] })

    expect(res.status).toBe(500)
  })
})
