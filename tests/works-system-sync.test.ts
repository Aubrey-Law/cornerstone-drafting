import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeRow {
  id: string
  slug: string | null
  skill_md: string
  is_active: boolean
  sort_order: number | null
  is_system: boolean
  [key: string]: unknown
}

const state: { rows: FakeRow[]; nextId: number; failNextInsertAsDuplicate: boolean } =
  { rows: [], nextId: 1, failNextInsertAsDuplicate: false }

function fakeDb() {
  return {
    from(table: string) {
      if (table !== 'work_skills') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              return Promise.resolve({
                data: state.rows.filter(row => row[column] === value),
                error: null,
              })
            },
          }
        },
        insert(row: Record<string, unknown>) {
          if (state.failNextInsertAsDuplicate) {
            state.failNextInsertAsDuplicate = false
            // Simulate the other admin's row landing first: the partial unique
            // index on slug rejects this insert.
            state.rows.push({ ...(row as FakeRow), id: `row-${state.nextId++}`, skill_md: 'written by the other admin' })
            return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
          }
          state.rows.push({ ...(row as FakeRow), id: `row-${state.nextId++}` })
          return Promise.resolve({ error: null })
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = []
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value])
              return chain
            },
            then(onFulfilled: (result: { error: null }) => unknown) {
              for (const row of state.rows) {
                if (filters.every(([column, value]) => row[column] === value)) Object.assign(row, patch)
              }
              return Promise.resolve({ error: null }).then(onFulfilled)
            },
          }
          return chain
        },
      }
    },
  }
}

vi.mock('@/lib/works/data', () => ({ worksDb: () => fakeDb() }))

import { syncSystemWorkflows } from '@/lib/works/systemSync'
import { listBundledSystemSkills } from '@/lib/works/systemSkills'

describe('system workflow sync', () => {
  beforeEach(() => {
    state.rows = []
    state.nextId = 1
    state.failNextInsertAsDuplicate = false
  })

  it('creates all bundled skills on first sync and is a no-op on re-run', async () => {
    const bundled = listBundledSystemSkills()

    const first = await syncSystemWorkflows()
    expect(first.created.sort()).toEqual(bundled.map(skill => skill.slug).sort())
    expect(first.updated).toEqual([])
    expect(first.deactivated).toEqual([])
    expect(state.rows).toHaveLength(bundled.length)
    for (const row of state.rows) {
      expect(row.is_system).toBe(true)
      expect(row.is_active).toBe(true)
      expect(row.owner_id).toBeNull()
      expect(row.source).toBe('system')
    }

    const second = await syncSystemWorkflows()
    expect(second.created).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.deactivated).toEqual([])
    expect(second.unchanged).toHaveLength(bundled.length)
  })

  it('updates rows whose stored markdown drifted from the tree', async () => {
    await syncSystemWorkflows()
    const target = state.rows.find(row => row.slug === 'trust-drafting-intake')!
    target.skill_md = '---\nstale\n---\nstale body'

    const result = await syncSystemWorkflows()
    expect(result.updated).toEqual(['trust-drafting-intake'])
    expect(target.skill_md).toContain('TRUST DRAFTING INTAKE')
  })

  it('deactivates system rows whose slug left the tree, never deletes', async () => {
    await syncSystemWorkflows()
    state.rows.push({
      id: 'row-legacy',
      slug: 'retired-skill',
      skill_md: '---\nold\n---\nold body',
      is_active: true,
      sort_order: 99,
      is_system: true,
    })

    const result = await syncSystemWorkflows()
    expect(result.deactivated).toEqual(['retired-skill'])
    const legacy = state.rows.find(row => row.slug === 'retired-skill')!
    expect(legacy.is_active).toBe(false)
    expect(state.rows).toHaveLength(listBundledSystemSkills().length + 1)
  })

  it('reactivates a previously deactivated skill that returns to the tree', async () => {
    await syncSystemWorkflows()
    const target = state.rows.find(row => row.slug === 'matter-next-steps')!
    target.is_active = false

    const result = await syncSystemWorkflows()
    expect(result.updated).toEqual(['matter-next-steps'])
    expect(target.is_active).toBe(true)
  })
})

describe('two admins pressing sync at once', () => {
  beforeEach(() => {
    state.rows = []
    state.nextId = 1
    state.failNextInsertAsDuplicate = false
  })

  it('converges on the row the other writer created instead of aborting the tree', async () => {
    const bundled = listBundledSystemSkills()
    state.failNextInsertAsDuplicate = true

    const result = await syncSystemWorkflows()

    // The losing insert becomes an update, and the rest of the tree still syncs.
    expect(result.updated).toHaveLength(1)
    expect(result.created).toHaveLength(bundled.length - 1)
    expect(state.rows).toHaveLength(bundled.length)
    for (const row of state.rows) expect(row.skill_md).not.toBe('written by the other admin')
  })
})

describe('syncing at boot', () => {
  it('runs the sync once per process however many times it is asked', async () => {
    const { ensureSystemWorkflowsSynced } = await import('@/lib/works/systemSync')
    const [first, second] = await Promise.all([ensureSystemWorkflowsSynced(), ensureSystemWorkflowsSynced()])

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(state.rows.length).toBe(listBundledSystemSkills().length)
  })
})

describe('a missing bundle never empties the library', () => {
  it('refuses to deactivate anything when the bundled tree cannot be found', async () => {
    await syncSystemWorkflows()
    const before = state.rows.filter(row => row.is_active).length

    await expect(syncSystemWorkflows({ root: '/definitely/not/here' })).rejects.toThrow(/bundled/i)

    expect(state.rows.filter(row => row.is_active).length).toBe(before)
  })
})
