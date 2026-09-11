import { describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ fail: false }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: () => {
  const chain = { select: () => chain, in: () => chain, eq: () => chain, order: () => chain,
    range: async (from: number, to: number) => ({ data: state.fail ? null : Array.from({ length: 2501 }, (_, n) => ({ id: String(n), status: 'open', due_at: '2020-01-01T12:00Z', soft_due_at: null, hard_due_at: null, assignee_id: 'viewer' })).slice(from, to + 1), error: state.fail ? new Error('offline') : null }) }
  return chain
} }) }))
import { fetchTaskCounts } from '@/lib/queries/tasks'
describe('complete task badges', () => {
  it('counts overdue tasks beyond the former 2000 row cap and does not turn failure into zero', async () => {
    expect(await fetchTaskCounts('viewer')).toMatchObject({ overdue: 2501, open: 2501, mine: 2501 })
    state.fail = true
    await expect(fetchTaskCounts()).rejects.toThrow('Task counts are unavailable')
  })
})
