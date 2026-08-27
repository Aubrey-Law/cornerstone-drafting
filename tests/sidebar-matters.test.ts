import { beforeEach, describe, expect, it, vi } from 'vitest'
// vi.mock is hoisted above imports, so the mocked admin client is in place
// before this module pulls in the query under test.
import { fetchSidebarMatters, SIDEBAR_RECENT_LIMIT } from '@/lib/queries/sidebarMatters'

/**
 * `fetchSidebarMatters` shapes the two lists the sidebar renders. The rules it
 * encodes are easy to get subtly wrong and invisible when they are:
 *
 * - pinned order comes from the user's stored list, not from the query;
 * - a pinned matter that has since been deleted drops out silently;
 * - recents never repeat something already pinned;
 * - the open matter stays listed, appended rather than promoted.
 */

const rows: Record<string, unknown[]> = { pipeline: [], numbers: [] }

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === 'matters') {
        return {
          select: () => ({ in: () => Promise.resolve({ data: rows.numbers, error: null }) }),
        }
      }
      // v_matter_pipeline — the recents query chains neq/order/limit, the pinned
      // query chains a single `in`.
      const pipeline = {
        select: () => ({
          neq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: rows.pipeline, error: null }),
            }),
          }),
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: (rows.pipeline as { matter_id: string }[]).filter(r => ids.includes(r.matter_id)),
              error: null,
            }),
        }),
      }
      return pipeline
    },
  }),
}))

function pipelineRow(id: string, createdDaysAgo: number, clientName = `Client ${id}`) {
  const created = new Date(Date.UTC(2026, 7, 27) - createdDaysAgo * 86_400_000).toISOString()
  return {
    matter_id: id,
    matter_name: `Matter ${id}`,
    client_name: clientName,
    documents_executed_at: null,
    drafts_sent_at: null,
    intake_submitted_at: null,
    matter_created: created,
  }
}

beforeEach(() => {
  rows.pipeline = []
  rows.numbers = []
})

describe('fetchSidebarMatters', () => {
  it('orders pinned matters by the stored list, not by recency', async () => {
    rows.pipeline = [pipelineRow('a', 1), pipelineRow('b', 30), pipelineRow('c', 10)]
    const result = await fetchSidebarMatters(['b', 'c', 'a'])
    expect(result.pinned.map(m => m.matter_id)).toEqual(['b', 'c', 'a'])
  })

  it('drops a pinned matter that no longer exists rather than rendering a hole', async () => {
    rows.pipeline = [pipelineRow('a', 1)]
    const result = await fetchSidebarMatters(['a', 'deleted-id'])
    expect(result.pinned.map(m => m.matter_id)).toEqual(['a'])
  })

  it('never repeats a pinned matter in recents', async () => {
    rows.pipeline = [pipelineRow('a', 1), pipelineRow('b', 2)]
    const result = await fetchSidebarMatters(['a'])
    expect(result.recent.map(m => m.matter_id)).not.toContain('a')
  })

  it('caps recents and sorts them newest first', async () => {
    rows.pipeline = Array.from({ length: SIDEBAR_RECENT_LIMIT + 4 }, (_, i) =>
      pipelineRow(`m${i}`, i),
    )
    const result = await fetchSidebarMatters([])
    expect(result.recent).toHaveLength(SIDEBAR_RECENT_LIMIT)
    expect(result.recent[0].matter_id).toBe('m0')
  })

  it('appends the open matter as the last row when it is too old to rank', async () => {
    rows.pipeline = Array.from({ length: SIDEBAR_RECENT_LIMIT + 4 }, (_, i) =>
      pipelineRow(`m${i}`, i),
    )
    const stale = `m${SIDEBAR_RECENT_LIMIT + 3}`
    const result = await fetchSidebarMatters([], stale)

    expect(result.recent).toHaveLength(SIDEBAR_RECENT_LIMIT)
    // Last, not first: promoting it would yank the clicked row upwards.
    expect(result.recent.at(-1)?.matter_id).toBe(stale)
    expect(result.recent[0].matter_id).toBe('m0')
  })

  it('leaves the list alone when the open matter already ranks', async () => {
    rows.pipeline = Array.from({ length: SIDEBAR_RECENT_LIMIT + 4 }, (_, i) =>
      pipelineRow(`m${i}`, i),
    )
    const result = await fetchSidebarMatters([], 'm1')
    expect(result.recent.map(m => m.matter_id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('does not duplicate the open matter into recents when it is pinned', async () => {
    rows.pipeline = [pipelineRow('a', 40), pipelineRow('b', 1)]
    const result = await fetchSidebarMatters(['a'], 'a')
    expect(result.recent.map(m => m.matter_id)).toEqual(['b'])
    expect(result.pinned.map(m => m.matter_id)).toEqual(['a'])
  })

  it('titles a row by client name, falling back to the matter name', async () => {
    rows.pipeline = [{ ...pipelineRow('a', 1), client_name: null }]
    const result = await fetchSidebarMatters([])
    expect(result.recent[0].title).toBe('Matter a')
  })
})
