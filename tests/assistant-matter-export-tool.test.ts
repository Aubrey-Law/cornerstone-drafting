import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMatterExportRows, clampMatterExportLimit } = vi.hoisted(() => ({
  fetchMatterExportRows: vi.fn(),
  clampMatterExportLimit: vi.fn((value: unknown) => Math.max(1, Math.min(2000, Math.floor(Number(value) || 500)))),
}))
vi.mock('@/lib/queries/matters', () => ({ fetchMatterExportRows, clampMatterExportLimit }))

import {
  EXPORT_MATTERS_TOOL_NAME,
  exportMattersToolExecutor,
  matterExportSystemPromptNote,
} from '@/lib/adminChat/matterExportTool'
import type { MatterTableFilters, MatterSortKey } from '@/lib/adminTables/matterTable'
import type { MatterExportRow } from '@/lib/matters/exportRows'

/**
 * The assistant's matter export: "list my open matters" answered from the
 * firm's own pipeline, with a CSV to download.
 */

const ROW: MatterExportRow = {
  client: 'Sam Smith',
  email: 'sam@example.com',
  phone: '617-555-0100',
  matterNumber: '2026-EP-Smith',
  matterName: 'Smith Family Trust',
  practiceArea: 'Estate Planning',
  stage: 'Design',
  intake: 'submitted',
  fee: '4500',
  lastMilestone: '2026-07-15',
}

function page(rows: MatterExportRow[], total = rows.length) {
  return { rows, total, truncated: total > rows.length }
}

describe('assistant matter export tool', () => {
  beforeEach(() => {
    fetchMatterExportRows.mockReset()
  })

  it('describes the columns it returns and that closed work is out unless asked for', () => {
    expect(exportMattersToolExecutor.tool.name).toBe(EXPORT_MATTERS_TOOL_NAME)
    expect(exportMattersToolExecutor.tool.description).toContain(
      'Closed and archived matters are left out unless include_closed is true',
    )
    const note = matterExportSystemPromptNote()
    expect(note).toContain(EXPORT_MATTERS_TOOL_NAME)
    expect(note).toContain('include_closed')
  })

  it('asks for closed matters only when the attorney does, and says so in the link', async () => {
    fetchMatterExportRows.mockResolvedValue(page([]))
    const result = await exportMattersToolExecutor.execute(
      { include_closed: true },
      { toolUseId: 'tool-closed', emit: vi.fn() },
    )

    const [filters] = fetchMatterExportRows.mock.calls[0] as [MatterTableFilters]
    expect(filters.includeClosed).toBe(true)
    expect(JSON.parse(result.content).download_url).toContain('closed=1')
  })

  it('returns the listed matters with a CSV link', async () => {
    fetchMatterExportRows.mockResolvedValue(page([ROW]))
    const events: Record<string, unknown>[] = []

    const result = await exportMattersToolExecutor.execute(
      {},
      { toolUseId: 'tool-1', emit: event => events.push(event) },
    )

    const payload = JSON.parse(result.content)
    expect(payload.ok).toBe(true)
    expect(payload.matters).toEqual([ROW])
    expect(payload.download_url).toContain('/api/admin/matters/export')
    expect(events).toContainEqual(expect.objectContaining({
      tool: EXPORT_MATTERS_TOOL_NAME,
      status: 'done',
      result: expect.objectContaining({ row_count: 1, download_url: payload.download_url }),
    }))
  })

  it('passes the attorney\'s filters through the matters list vocabulary', async () => {
    fetchMatterExportRows.mockResolvedValue(page([]))
    const result = await exportMattersToolExecutor.execute(
      { search: 'Smith', practice_area: 'Probate', stage_group: 'done', sort: 'newest' },
      { toolUseId: 'tool-2', emit: vi.fn() },
    )

    const [filters, options] = fetchMatterExportRows.mock.calls[0] as [
      MatterTableFilters,
      { sort: MatterSortKey; limit: number },
    ]
    expect(filters).toEqual({ search: 'Smith', practice: 'Probate', stageGroup: 'done', includeClosed: false })
    expect(options.sort).toBe('newest')

    // The link handed back describes the same selection the rows came from.
    const query = new URLSearchParams(JSON.parse(result.content).download_url.split('?')[1])
    expect(Object.fromEntries(query)).toEqual({
      search: 'Smith',
      practice: 'Probate',
      stage: 'done',
      sort: 'newest',
    })
  })

  it('defaults to every open matter, alphabetically', async () => {
    fetchMatterExportRows.mockResolvedValue(page([ROW]))
    const result = await exportMattersToolExecutor.execute({}, { toolUseId: 'tool-3', emit: vi.fn() })

    const [filters, options] = fetchMatterExportRows.mock.calls[0] as [
      MatterTableFilters,
      { sort: MatterSortKey },
    ]
    expect(filters).toEqual({ search: '', practice: 'all', stageGroup: 'all', includeClosed: false })
    // A list of clients is read by name, not by recency.
    expect(options.sort).toBe('client_asc')
    expect(JSON.parse(result.content).filters).toMatchObject({ stage_group: 'all', search: null })
  })

  it('caps the rows read into the conversation and says how many matched', async () => {
    fetchMatterExportRows.mockResolvedValue(page([ROW], 900))
    const result = await exportMattersToolExecutor.execute(
      { limit: 5000 },
      { toolUseId: 'tool-4', emit: vi.fn() },
    )

    const options = fetchMatterExportRows.mock.calls[0][1] as { limit: number }
    expect(options.limit).toBeLessThanOrEqual(200)
    expect(JSON.parse(result.content)).toMatchObject({ total_matching: 900, truncated: true })
  })

  it('reports a failed read as a tool error rather than an empty list', async () => {
    fetchMatterExportRows.mockRejectedValue(new Error('pipeline view missing'))
    const events: Record<string, unknown>[] = []

    const result = await exportMattersToolExecutor.execute(
      {},
      { toolUseId: 'tool-5', emit: event => events.push(event) },
    )

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: 'pipeline view missing' })
    expect(events).toContainEqual(expect.objectContaining({ status: 'error' }))
  })
})
