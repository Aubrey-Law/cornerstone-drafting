import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTasks, TASK_PAGE_SIZE } from '@/lib/queries/tasks'
import { taskFixture } from './fixtures/task'

const { state } = vi.hoisted(() => ({ state: { page: 0, failAt: 0 } }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => {
    const read = () => Promise.resolve(state.page++ === state.failAt
      ? { data: null, error: { message: 'database unavailable' } }
      : { data: Array.from({ length: TASK_PAGE_SIZE }, (_, i) => taskFixture({ id: String(i) })), error: null })
    const chain: Record<string, unknown> = { range: read, limit: read }
    for (const key of ['select', 'eq', 'in', 'order', 'is', 'neq']) chain[key] = () => chain
    return chain
  } }),
}))
afterEach(() => { state.page = 0; state.failAt = 0; vi.restoreAllMocks() })

describe('failed task reads', () => {
  it('rejects an initial query failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(fetchTasks()).rejects.toThrow('database unavailable')
  })
  it('rejects a later page failure rather than losing already loaded work', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failAt = 1
    await expect(fetchTasks({ all: true })).rejects.toThrow('database unavailable')
  })
})
