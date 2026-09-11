import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc }) }))
import { fetchDraftingHubMatters } from '@/lib/queries/drafting'
import { hubPageUrl, parseHubPage } from '@/lib/drafting/hubView'

beforeEach(() => rpc.mockReset())
describe('server-owned drafting worklist', () => {
  it('passes every filter and bounded pagination to the database, preserves its global facets and page order', async () => {
    rpc.mockResolvedValue({ data: { rows: [], total: 107, page: 3, pageSize: 50, actionCounts: { all: 140, review: 107 }, practiceCounts: [{ name: 'Estate Planning', count: 107 }] }, error: null })
    const query = parseHubPage(new URLSearchParams('search=Doe+family&action=review&practice=Estate+Planning&sort=client&page=3'))
    const result = await fetchDraftingHubMatters(query)
    expect(rpc).toHaveBeenCalledWith('drafting_hub_page', { p_search: 'Doe family', p_action: 'review', p_practice: 'Estate Planning', p_sort: 'client', p_page: 3, p_page_size: 50 })
    expect(result).toMatchObject({ total: 107, page: 3, actionCounts: { all: 140, review: 107 }, practiceCounts: [{ name: 'Estate Planning', count: 107 }], error: null })
  })
  it('keeps server row order and binds review metadata to the current immutable version without leaking storage keys', async () => {
    const draft = { id: 'draft', name: 'Will.docx', size: 12, created_at: '2026-09-11', r2_key: 'private/key', current_version_id: 'version-1' }
    const row = (id: string) => ({ matter: { matter_id: id, flags: null }, sheet: null, matterNumber: null, selections: [], currentDraftCount: 1, supersededDraftCount: 0, recentDrafts: [draft] })
    rpc.mockResolvedValue({ data: { rows: [row('z'), row('a')], total: 2, page: 1, pageSize: 50, actionCounts: {}, practiceCounts: [] }, error: null })
    const result = await fetchDraftingHubMatters()
    expect(result.matters.map(item => item.matter.matter_id)).toEqual(['z', 'a'])
    const first = result.matters[0].recentDrafts[0]
    expect(first.reviewRevision).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toHaveProperty('r2_key')
    draft.current_version_id = 'version-2'
    const changed = await fetchDraftingHubMatters()
    expect(changed.matters[0].recentDrafts[0].reviewRevision).not.toBe(first.reviewRevision)
  })
  it('honors the canonical page returned when the requested page is now empty', async () => {
    rpc.mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 50, actionCounts: {}, practiceCounts: [] }, error: null })
    const result = await fetchDraftingHubMatters(parseHubPage(new URLSearchParams('page=900')))
    expect(result.page).toBe(1)
    expect(result.matters).toEqual([])
  })
  it('fails visibly when the required RPC is missing instead of displaying truncated fallback totals', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } })
    expect(await fetchDraftingHubMatters()).toMatchObject({ matters: [], total: 0, error: 'function not found' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('bounds page URL input without changing saved-view serialization', () => {
    expect(parseHubPage(new URLSearchParams('page=-2')).page).toBe(1)
    expect(parseHubPage(new URLSearchParams('page=2.5')).page).toBe(1)
    expect(parseHubPage(new URLSearchParams('page=Infinity')).page).toBe(1)
    const page = parseHubPage(new URLSearchParams('page=3&search=Smith&sort=action'))
    expect(hubPageUrl(page)).toBe('/admin/drafting?view=all&search=Smith&sort=action&page=3')
  })
})
