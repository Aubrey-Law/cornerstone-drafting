import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The drafting badge used to download every design_sheets.matter_id and
 * subtract that set from the open matters. PostgREST max_rows is 1000, and
 * design_sheets keeps a row per version, including closed matters, so the
 * first thousand rows could omit a newer open matter's sheet. That matter
 * then counted as still needing one.
 *
 * The pipeline view already exposes the newest sheet as design_status. A null
 * is the absence of a row, because a sheet's status is not nullable. An exact
 * head count is not truncated.
 */

type Filter = { op: string; column: string; value: unknown }

const calls: Array<{ table: string; head: boolean; filters: Filter[] }> = []

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: string) {
      const call = { table, head: false, filters: [] as Filter[] }
      calls.push(call)
      const builder: Record<string, unknown> = {
        select: (_columns: string, options?: { head?: boolean }) => {
          call.head = options?.head === true
          return builder
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: [],
            error: null,
            count: call.table === 'v_matter_pipeline' && call.filters.some(filter => filter.column === 'design_status') ? 3 : 0,
          }).then(resolve, reject),
      }
      for (const op of ['eq', 'neq', 'is', 'in', 'gt', 'lt', 'or', 'not', 'order']) {
        builder[op] = (column: string, value: unknown) => {
          call.filters.push({ op, column, value })
          return builder
        }
      }
      builder.range = () => builder
      return builder
    },
  }),
}))

import { fetchSidebarCounts } from '@/lib/queries/sidebarCounts'

beforeEach(() => {
  calls.length = 0
})

describe('the drafting sidebar badge', () => {
  it('counts open matters whose newest design sheet is missing', async () => {
    const counts = await fetchSidebarCounts()
    const drafting = calls.filter(call => call.filters.some(filter => filter.column === 'design_status'))

    expect(drafting).toEqual([
      {
        table: 'v_matter_pipeline',
        head: true,
        filters: [
          { op: 'neq', column: 'stage', value: 'closed' },
          { op: 'is', column: 'design_status', value: null },
        ],
      },
    ])
    expect(calls.some(call => call.table === 'design_sheets')).toBe(false)
    expect(counts.draftingNeedsDesignCount).toBe(3)
    expect(counts.errors).not.toContain('draftingNeedsDesignCount')
  })
})
