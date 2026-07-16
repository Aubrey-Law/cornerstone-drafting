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

const state: { rows: FakeRow[]; nextId: number } = { rows: [], nextId: 1 }

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
          state.rows.push({ ...(row as FakeRow), id: `row-${state.nextId++}` })
          return Promise.resolve({ error: null })
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: unknown) {
              for (const row of state.rows) {
                if (row[column] === value) Object.assign(row, patch)
              }
              return Promise.resolve({ error: null })
            },
          }
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
