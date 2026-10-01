import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  fetchLeadExportRows: vi.fn(),
  fetchWorkGraphForUser: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/queries/leadList', () => ({ fetchLeadExportRows: mocks.fetchLeadExportRows }))
vi.mock('@/lib/work/server', () => ({ fetchWorkGraphForUser: mocks.fetchWorkGraphForUser }))

import { GET } from '@/app/api/admin/leads/export/route'
import { LEAD_EXPORT_MAX_ROWS } from '@/lib/leads/exportRows'
import type { LeadListParams } from '@/lib/leads/listParams'

const ROWS = [
  { id: 'l1', name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
  { id: 'l2', name: 'Sam Rivera', email: 'sam@example.com', phone: '' },
]

describe('the leads contact export route', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset()
    mocks.fetchLeadExportRows.mockReset()
    mocks.fetchWorkGraphForUser.mockReset()
    mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'admin-1', user: null })
    mocks.fetchLeadExportRows.mockResolvedValue({ rows: ROWS, total: ROWS.length, truncated: false })
    mocks.fetchWorkGraphForUser.mockResolvedValue({ items: [], appointments: [], sourceErrors: [], generatedAt: '' })
  })

  it('is admin-only — client contact data never leaves on an unauthenticated request', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })
    const response = await GET(new Request('https://app.test/api/admin/leads/export'))
    expect(response.status).toBe(401)
    expect(mocks.fetchLeadExportRows).not.toHaveBeenCalled()
  })

  it('returns name, email and phone as a downloadable CSV', async () => {
    const response = await GET(new Request('https://app.test/api/admin/leads/export?status=open'))

    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="cornerstone-leads-open-')
    // A lead list is client contact data; no proxy should hold a copy.
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe(
      'Name,Email,Phone\nJane Doe,jane@example.com,617-555-0100\nSam Rivera,sam@example.com,',
    )
  })

  it('exports the selection the filters describe, alphabetically, and to the row ceiling', async () => {
    await GET(new Request('https://app.test/api/admin/leads/export?status=all&search=Doe&practice=Probate&progress=intake_complete'))

    const [params, options] = mocks.fetchLeadExportRows.mock.calls[0] as [LeadListParams, { limit: number }]
    expect(params).toMatchObject({
      status: 'all',
      search: 'Doe',
      practice: 'Probate',
      progress: 'intake_complete',
      sort: 'name_asc',
    })
    expect(options.limit).toBe(LEAD_EXPORT_MAX_ROWS)
  })

  it('narrows by an insight card, so a page export matches the list under one', async () => {
    await GET(new Request('https://app.test/api/admin/leads/export?card=attention'))
    expect((mocks.fetchLeadExportRows.mock.calls[0][0] as LeadListParams).card).toBe('attention')
    expect(mocks.fetchLeadExportRows.mock.calls[0][1]).toMatchObject({ attentionIds: [] })
  })

  it('answers format=json with the same three fields', async () => {
    const response = await GET(new Request('https://app.test/api/admin/leads/export?format=json'))
    expect(await response.json()).toEqual({
      leads: [
        { name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
        { name: 'Sam Rivera', email: 'sam@example.com', phone: '' },
      ],
      total: 2,
      truncated: false,
    })
  })

  it('reports a failed read rather than downloading an empty file', async () => {
    mocks.fetchLeadExportRows.mockRejectedValue(new Error('view missing'))
    const response = await GET(new Request('https://app.test/api/admin/leads/export'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'view missing' })
  })
})
