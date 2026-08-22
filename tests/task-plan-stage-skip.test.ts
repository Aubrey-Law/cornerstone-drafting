import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), admin: null as unknown }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))

import { PATCH } from '@/app/api/matters/[matterId]/tasks/phase/route'
import { SLA_PHASES } from '@/lib/slaTasks/types'

/**
 * Marking a whole stage not applicable.
 *
 * A will-only matter does not need the Design stage. Saying so a task at a time
 * is ten clicks for one decision, which is how a plan stops being kept up — so
 * the stage card says it once.
 *
 * What the endpoint must not do is as important as what it does: completed work
 * survives, and the rows the closeout sweep archived are the matter's business,
 * not the stage's.
 */

const MATTER = '11111111-1111-4111-8111-111111111111'

interface Call {
  update?: Record<string, unknown>
  filters: Array<{ op: string; args: unknown[] }>
}

let call: Call
let result: { data: unknown[]; error: { message: string } | null }

function client() {
  return {
    from() {
      const chain: Record<string, unknown> = {}
      for (const op of ['eq', 'in', 'or', 'not', 'is']) {
        chain[op] = (...args: unknown[]) => {
          call.filters.push({ op, args })
          return chain
        }
      }
      chain.update = (values: Record<string, unknown>) => {
        call.update = values
        return chain
      }
      chain.select = async () => result
      return chain
    },
  }
}

function request(body: unknown) {
  return new Request(`http://test/api/matters/${MATTER}/tasks/phase`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ matterId: MATTER }) }

const patch = (body: unknown) => PATCH(request(body), params)

function filter(op: string) {
  return call.filters.find(f => f.op === op)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  mocks.admin = client()
  call = { filters: [] }
  result = { data: [{ id: 't-1' }, { id: 't-2' }], error: null }
})

describe('marking a stage not applicable', () => {
  it('skips only the work still outstanding, never what was completed', async () => {
    await patch({ phase: 'design', status: 'skipped' })

    const statuses = filter('in')
    expect(statuses?.args[0]).toBe('status')
    // `done` absent by design: a stage turning out not to apply does not unmake
    // the work already performed under it.
    expect(statuses?.args[1]).toEqual(['open', 'in_progress', 'blocked'])
  })

  it('writes the same stamps the per-task skip writes', async () => {
    await patch({ phase: 'design', status: 'skipped' })

    expect(call.update).toMatchObject({ status: 'archived', completed_at: null })
    expect(call.update?.skipped_at).toEqual(expect.any(String))
  })

  it('is scoped to the one stage on the one matter', async () => {
    await patch({ phase: 'drafting', status: 'skipped' })

    const eqs = call.filters.filter(f => f.op === 'eq').map(f => f.args)
    expect(eqs).toContainEqual(['matter_id', MATTER])
    expect(eqs).toContainEqual(['phase', 'drafting'])
  })

  it('reports how many rows it touched', async () => {
    const body = await (await patch({ phase: 'design', status: 'skipped' })).json()

    expect(body.updated).toBe(2)
    expect(body.phase).toBe('design')
  })
})

describe('restoring a stage', () => {
  it('reopens only rows a skip archived, not everything archived', async () => {
    await patch({ phase: 'design', status: 'open' })

    expect(call.filters.filter(f => f.op === 'eq').map(f => f.args)).toContainEqual([
      'status',
      'archived',
    ])
    expect(filter('not')?.args).toEqual(['skipped_at', 'is', null])
  })

  it('leaves the closeout sweep’s rows for the matter to bring back', async () => {
    await patch({ phase: 'design', status: 'open' })

    // Without this, restoring a stage on a lost lead would strip the marker the
    // lead-reactivation path relies on. See lib/tasks/closeout.ts.
    expect(filter('is')?.args).toEqual(['closeout_reason', null])
  })

  it('clears the skip stamp on the way back', async () => {
    await patch({ phase: 'design', status: 'open' })

    expect(call.update).toMatchObject({ status: 'open', skipped_at: null, closeout_reason: null })
  })
})

describe('the unphased card', () => {
  it('matches every row the board shows under “No stage”', async () => {
    await patch({ phase: 'unphased', status: 'skipped' })

    // A null phase *and* any value the vocabulary no longer knows — filtering on
    // `is null` alone would leave rows on the card that the card's own action
    // never touched.
    expect(filter('or')?.args[0]).toBe(`phase.is.null,phase.not.in.(${SLA_PHASES.join(',')})`)
  })

  it('does not filter on a phase column value', async () => {
    await patch({ phase: 'unphased', status: 'skipped' })

    expect(call.filters.filter(f => f.op === 'eq').map(f => f.args[0])).not.toContain('phase')
  })
})

describe('what it refuses', () => {
  it('rejects a stage outside the plan vocabulary', async () => {
    const res = await patch({ phase: 'not_a_stage', status: 'skipped' })

    expect(res.status).toBe(400)
    expect(call.update).toBeUndefined()
  })

  it('rejects a status the stage action does not offer', async () => {
    // 'done' is not a stage-level decision: finishing work is per task.
    const res = await patch({ phase: 'design', status: 'done' })

    expect(res.status).toBe(400)
    expect(call.update).toBeUndefined()
  })

  it('never writes without admin auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response('no', { status: 401 }) })

    const res = await patch({ phase: 'design', status: 'skipped' })

    expect(res.status).toBe(401)
    expect(call.update).toBeUndefined()
  })

  it('surfaces a failed write instead of reporting a skip that did not happen', async () => {
    result = { data: [], error: { message: 'permission denied' } }

    const res = await patch({ phase: 'design', status: 'skipped' })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('permission denied')
  })
})
