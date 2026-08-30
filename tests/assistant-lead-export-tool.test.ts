import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchLeadExportRows } = vi.hoisted(() => ({ fetchLeadExportRows: vi.fn() }))
vi.mock('@/lib/queries/leadList', () => ({ fetchLeadExportRows }))

import {
  EXPORT_LEADS_TOOL_NAME,
  exportLeadsToolExecutor,
  leadExportSystemPromptNote,
} from '@/lib/adminChat/leadExportTool'
import type { LeadListParams } from '@/lib/leads/listParams'

/**
 * The assistant's lead export: "give me a list of leads with name, email and
 * phone" answered from the firm's own pipeline, with a CSV to download.
 */

function page(rows: Array<{ name: string; email: string; phone: string }>, total = rows.length) {
  return {
    rows: rows.map((row, index) => ({ id: `lead-${index}`, ...row })),
    total,
    truncated: total > rows.length,
  }
}

describe('assistant lead export tool', () => {
  // Braces matter: a hook that *returns* the mock hands Vitest a teardown
  // function, which then calls the mock again after the test.
  beforeEach(() => {
    fetchLeadExportRows.mockReset()
  })

  it('offers the three contact fields the attorney asks for', () => {
    expect(exportLeadsToolExecutor.tool.name).toBe(EXPORT_LEADS_TOOL_NAME)
    expect(exportLeadsToolExecutor.tool.description).toContain('name, email and phone')
    const note = leadExportSystemPromptNote()
    expect(note).toContain(EXPORT_LEADS_TOOL_NAME)
    expect(note).toContain('Name | Email | Phone')
  })

  it('returns each lead as name, email and phone with a CSV link', async () => {
    fetchLeadExportRows.mockResolvedValue(page([
      { name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
      { name: 'Sam Rivera', email: 'sam@example.com', phone: '' },
    ]))
    const events: Record<string, unknown>[] = []

    const result = await exportLeadsToolExecutor.execute(
      {},
      { toolUseId: 'tool-1', emit: event => events.push(event) },
    )

    const payload = JSON.parse(result.content)
    expect(payload.ok).toBe(true)
    expect(payload.leads).toEqual([
      { name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
      { name: 'Sam Rivera', email: 'sam@example.com', phone: '' },
    ])
    expect(payload.download_url).toContain('/api/admin/leads/export?')
    expect(payload.download_url).toContain('status=open')
    // The card the attorney sees needs the count and the link, not the rows.
    expect(events).toContainEqual(expect.objectContaining({
      tool: EXPORT_LEADS_TOOL_NAME,
      status: 'done',
      result: expect.objectContaining({ lead_count: 2, download_url: payload.download_url }),
    }))
  })

  it('defaults to open leads and passes the attorney\'s filters to the query', async () => {
    fetchLeadExportRows.mockResolvedValue(page([]))
    await exportLeadsToolExecutor.execute(
      { status: 'all', practice_area: 'Probate', progress: 'intake_complete', search: 'Doe' },
      { toolUseId: 'tool-2', emit: vi.fn() },
    )

    const params = fetchLeadExportRows.mock.calls[0][0] as LeadListParams
    expect(params).toMatchObject({
      status: 'all',
      practice: 'Probate',
      progress: 'intake_complete',
      search: 'Doe',
      // Alphabetical: a contact list is read by name, not by recency.
      sort: 'name_asc',
    })

    await exportLeadsToolExecutor.execute({}, { toolUseId: 'tool-3', emit: vi.fn() })
    expect((fetchLeadExportRows.mock.calls[1][0] as LeadListParams).status).toBe('open')
  })

  it('caps the rows read into the conversation and says how many matched', async () => {
    fetchLeadExportRows.mockResolvedValue(page(
      [{ name: 'Jane Doe', email: 'jane@example.com', phone: '' }],
      900,
    ))

    const result = await exportLeadsToolExecutor.execute(
      { limit: 5000 },
      { toolUseId: 'tool-4', emit: vi.fn() },
    )

    const requestedLimit = (fetchLeadExportRows.mock.calls[0][1] as { limit: number }).limit
    expect(requestedLimit).toBeLessThanOrEqual(200)
    const payload = JSON.parse(result.content)
    expect(payload.total_matching).toBe(900)
    expect(payload.truncated).toBe(true)
  })

  it('reports a failed read as a tool error rather than an empty list', async () => {
    fetchLeadExportRows.mockRejectedValue(new Error('view missing'))
    const events: Record<string, unknown>[] = []

    const result = await exportLeadsToolExecutor.execute(
      {},
      { toolUseId: 'tool-5', emit: event => events.push(event) },
    )

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: 'view missing' })
    expect(events).toContainEqual(expect.objectContaining({ status: 'error' }))
  })
})
