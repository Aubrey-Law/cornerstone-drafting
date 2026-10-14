import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  ensure: vi.fn(async () => true),
  rows: [] as Array<Record<string, unknown> | null>,
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({
  ensureDesignSheetSeededFromIntake: mocks.ensure,
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      const eq = (column: string, value: unknown) => {
        filters[column] = value
        return chain
      }
      chain.select = () => chain
      chain.eq = eq
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => {
        if (table === 'matters') {
          return filters.id === 'missing'
            ? { data: null, error: null }
            : { data: { id: 'matter-1' }, error: null }
        }
        const row = mocks.rows.shift() ?? null
        return { data: row, error: null }
      }
      chain.update = (patch: Record<string, unknown>) => {
        mocks.updates.push({ ...patch, filters: { ...filters } })
        return chain
      }
      chain.then = undefined
      Object.assign(chain, {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
          data: filters.updated_at === 'stale' ? [] : [{ id: 'sheet-1' }],
          error: null,
        })),
      })
      return chain
    },
  }),
}))

import { PATCH } from '@/app/api/admin/matters/[id]/plan-type/route'

const patch = (planType: unknown, id = 'matter-1') => PATCH(
  new Request('http://test/api/admin/matters/matter-1/plan-type', {
    method: 'PATCH',
    body: JSON.stringify({ planType }),
  }),
  { params: Promise.resolve({ id }) },
)

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ err: null })
  mocks.ensure.mockClear()
  mocks.rows = []
  mocks.updates = []
})

describe('PATCH plan type', () => {
  it('writes the design sheet and the trust package the new plan requires', async () => {
    mocks.rows = [{
      id: 'sheet-1',
      matter_id: 'matter-1',
      updated_at: '2026-10-01T00:00:00.000Z',
      plan_type: 'pour_over',
      marital_status: 'married',
      decisions: { document_inclusions: { trust: true } },
    }]
    const response = await patch('testamentary_trust')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ matterId: 'matter-1', planType: 'testamentary_trust' })
    expect(mocks.ensure).not.toHaveBeenCalled()
    const update = mocks.updates[0]
    expect(update.plan_type).toBe('testamentary_trust')
    expect(update.decisions).toMatchObject({
      document_inclusions: { trust: false },
      estate_plan_design: { trust: false, will_title: 'last_will' },
    })
  })

  it('seeds a sheet when the matter does not have one yet', async () => {
    mocks.rows = [null, {
      id: 'sheet-1',
      matter_id: 'matter-1',
      updated_at: '2026-10-01T00:00:00.000Z',
      plan_type: null,
      decisions: {},
    }]
    const response = await patch('outright_will')
    expect(response.status).toBe(200)
    expect(mocks.ensure).toHaveBeenCalledWith('matter-1')
    expect(mocks.updates[0].plan_type).toBe('outright_will')
    expect(mocks.updates[0].decisions).toBeUndefined()
  })

  it('rejects a plan this firm does not draft', async () => {
    const response = await patch('trust_plan')
    expect(response.status).toBe(400)
    expect(mocks.updates).toHaveLength(0)
  })
})
