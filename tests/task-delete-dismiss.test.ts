import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), admin: null as unknown }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))

import { DELETE } from '@/app/api/admin/tasks/[id]/route'
import { DISMISS_ON_DELETE_SOURCES, dismissesOnDelete } from '@/lib/tasks/dismiss'

/**
 * Deleting one task from the detail sheet.
 *
 * Generated tasks used to be hard-deleted, and the row was the only thing
 * telling their sweep "already said this" — so they reappeared within a tick.
 * They are dismissed instead; a task a person wrote is still deleted outright.
 */

const ID = '11111111-1111-4111-8111-111111111111'

let row: { id: string; source: string } | null
let ops: Array<{ op: 'delete' | 'update'; update?: Record<string, unknown> }>

function client() {
  return {
    from() {
      const chain: Record<string, unknown> = {}
      let op: 'select' | 'delete' | 'update' = 'select'
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = () => chain
      chain.maybeSingle = async () => ({ data: row, error: null })
      chain.delete = () => { op = 'delete'; ops.push({ op }); return chain }
      chain.update = (update: Record<string, unknown>) => { op = 'update'; ops.push({ op, update }); return chain }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: op === 'select' ? null : row ? [{ id: row.id }] : [], error: null }).then(resolve)
      return chain
    },
  }
}

const del = () => DELETE(new Request(`http://test/api/admin/tasks/${ID}`, { method: 'DELETE' }), {
  params: Promise.resolve({ id: ID }),
})

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  mocks.admin = client()
  ops = []
})

describe('deleting a single task', () => {
  it('hard-deletes a task a person wrote', async () => {
    row = { id: ID, source: 'manual' }

    const body = await (await del()).json()

    expect(ops.map(o => o.op)).toEqual(['delete'])
    expect(body).toMatchObject({ ok: true, dismissed: false })
  })

  it.each(['fiduciary', 'identity', 'sla', 'prompt'])('dismisses a %s task instead', async source => {
    row = { id: ID, source }

    const body = await (await del()).json()

    expect(ops.map(o => o.op)).toEqual(['update'])
    expect(ops[0].update).toMatchObject({ status: 'archived', closeout_reason: null })
    expect(body).toMatchObject({ ok: true, dismissed: true })
  })

  it('treats a task that is already gone as deleted', async () => {
    row = null

    expect((await del()).status).toBe(200)
    expect(ops).toEqual([])
  })
})

describe('which sources dismiss', () => {
  it('covers every generator that re-emits, and not hand-made work', () => {
    expect([...DISMISS_ON_DELETE_SOURCES].sort()).toEqual(['fiduciary', 'identity', 'prompt', 'sla'])
    expect(dismissesOnDelete('manual')).toBe(false)
    expect(dismissesOnDelete('template')).toBe(false)
    expect(dismissesOnDelete(null)).toBe(false)
  })
})
