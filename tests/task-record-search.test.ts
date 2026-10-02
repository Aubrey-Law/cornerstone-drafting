import { beforeEach, describe, expect, it, vi } from 'vitest'

const selects: { table: string; cols: string }[] = []
const filters: { table: string; filter: string }[] = []
let tables: Record<string, unknown[]> = {}

function chainFor(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null })
  const chain: Record<string, unknown> = {}
  for (const method of ['eq', 'not', 'order']) chain[method] = () => chain
  chain.or = (filter: string) => {
    filters.push({ table, filter })
    return chain
  }
  chain.select = (cols: string) => {
    selects.push({ table, cols })
    return chain
  }
  chain.limit = () => chain
  chain.then = (resolve: (value: ReturnType<typeof result>) => unknown) =>
    Promise.resolve(result()).then(resolve)
  return chain
}

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ userId: 'staff-1' }),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: (table: string) => chainFor(table) }),
}))

const getTaskRecords: typeof import('@/app/api/admin/tasks/records/route').GET = async req =>
  (await import('@/app/api/admin/tasks/records/route')).GET(req)

beforeEach(() => {
  selects.length = 0
  filters.length = 0
  tables = {
    v_matter_pipeline_all: [{
      matter_id: 'matter-1',
      matter_name: 'Whitfield Estate Plan',
      client_name: 'Margaret Whitfield',
      stage: 'design',
    }],
    client_intake: [],
  }
})

describe('task record picker', () => {
  it('uses the hired matter pipeline, which carries the derived client name', async () => {
    const response = await getTaskRecords(new Request('http://localhost/api/admin/tasks/records?q=Whitfield'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      records: [{ id: 'matter-1', name: 'Margaret Whitfield', kind: 'matter', detail: 'design' }],
    })
    expect(selects).toContainEqual({
      table: 'v_matter_pipeline_all',
      cols: 'matter_id, matter_name, client_name, stage',
    })
    expect(selects.some(select => select.table === 'matters')).toBe(false)
    expect(filters).toContainEqual({
      table: 'v_matter_pipeline_all',
      filter: 'matter_name.ilike.%Whitfield%,client_name.ilike.%Whitfield%,matter_number.ilike.%Whitfield%',
    })
  })

  it('falls back to the matter name when the intake has no displayable name', async () => {
    tables.v_matter_pipeline_all = [{
      matter_id: 'matter-1', matter_name: 'Whitfield Estate Plan', client_name: '   ', stage: 'design',
    }]

    const response = await getTaskRecords(new Request('http://localhost/api/admin/tasks/records?q=Whitfield'))

    await expect(response.json()).resolves.toEqual({
      records: [{ id: 'matter-1', name: 'Whitfield Estate Plan', kind: 'matter', detail: 'design' }],
    })
  })
})
