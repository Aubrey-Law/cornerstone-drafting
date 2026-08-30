import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampLeadExportLimit,
  LEAD_EXPORT_MAX_ROWS,
  leadExportCsv,
  leadExportFilename,
  leadExportName,
  toLeadExportRow,
} from '@/lib/leads/exportRows'
import { leadListParamsFrom } from '@/lib/leads/listParams'

/**
 * The lead contact export: name, email and phone, from the same filtered
 * selection the leads list shows.
 */

const calls: Array<{ method: string; args: unknown[] }> = []
let queryResult: { data: unknown[]; error: { message: string } | null; count: number | null } = {
  data: [],
  error: null,
  count: 0,
}

function builder() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'or', 'is', 'not', 'order']) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }
  }
  chain.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args })
    return Promise.resolve(queryResult)
  }
  return chain
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: (table: string) => { calls.push({ method: 'from', args: [table] }); return builder() } }),
}))

// Static: vi.mock is hoisted above it, so the module under test sees the stub.
import { fetchLeadExportRows } from '@/lib/queries/leadList'

afterEach(() => {
  calls.length = 0
  queryResult = { data: [], error: null, count: 0 }
})

describe('lead export rows', () => {
  it('resolves a name the way the list does: full name, else first and last, else email', () => {
    expect(leadExportName({ full_name: 'Jane Q. Doe', first_name: 'Jane', last_name: 'Doe' })).toBe('Jane Q. Doe')
    expect(leadExportName({ first_name: 'Jane', last_name: 'Doe' })).toBe('Jane Doe')
    expect(leadExportName({ email: 'jane@example.com' })).toBe('jane@example.com')
    expect(leadExportName({})).toBe('')
  })

  it('keeps a missing email or phone empty rather than inventing one', () => {
    expect(toLeadExportRow({ id: 'lead-1', full_name: ' Jane Doe ', email: null, phone: undefined }))
      .toEqual({ id: 'lead-1', name: 'Jane Doe', email: '', phone: '' })
  })
})

describe('lead export CSV', () => {
  it('writes the three requested columns, in order, with a header', () => {
    const csv = leadExportCsv([
      { id: '1', name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
    ])
    expect(csv.split('\n')).toEqual([
      'Name,Email,Phone',
      'Jane Doe,jane@example.com,617-555-0100',
    ])
  })

  it('quotes a value holding a comma, a quote or a newline', () => {
    const csv = leadExportCsv([
      { id: '1', name: 'Doe, Jane "JD"', email: 'jane@example.com', phone: 'home\n617-555-0100' },
    ])
    expect(csv).toContain('"Doe, Jane ""JD"""')
    expect(csv).toContain('"home\n617-555-0100"')
  })

  it('defuses a value a spreadsheet would run as a formula', () => {
    // A phone number stored as "+1 617 555 0100" is text, not a sum.
    const csv = leadExportCsv([{ id: '1', name: '=cmd', email: '', phone: '+1 617 555 0100' }])
    expect(csv).toContain("'=cmd")
    expect(csv).toContain("'+1 617 555 0100")
  })

  it('names the file by the status exported and the day', () => {
    expect(leadExportFilename('open', new Date('2026-08-30T12:00:00Z')))
      .toBe('cornerstone-leads-open-2026-08-30.csv')
  })

  it('caps a hand-edited limit and falls back when it is not a number', () => {
    expect(clampLeadExportLimit(1_000_000)).toBe(LEAD_EXPORT_MAX_ROWS)
    expect(clampLeadExportLimit(0)).toBe(1)
    expect(clampLeadExportLimit('all of them')).toBeGreaterThan(0)
  })
})

describe('leadListParamsFrom', () => {
  it('reads the list vocabulary and falls back on anything else', () => {
    expect(leadListParamsFrom({ status: 'lost', progress: 'intake_complete', search: '  Doe  ' }))
      .toMatchObject({ status: 'lost', progress: 'intake_complete', search: 'Doe' })
    expect(leadListParamsFrom({ status: 'everything' })).toMatchObject({ status: 'open' })
    expect(leadListParamsFrom({}, { sort: 'name_asc' })).toMatchObject({ sort: 'name_asc' })
  })
})

describe('fetchLeadExportRows', () => {
  it('filters in the database and reports the total behind the cap', async () => {
    queryResult = {
      data: [{ id: 'lead-1', display_name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' }],
      error: null,
      count: 42,
    }

    const page = await fetchLeadExportRows(
      leadListParamsFrom({ status: 'open', search: 'Doe' }, { sort: 'name_asc' }),
      { limit: 1 },
    )

    expect(calls.find(call => call.method === 'from')?.args[0]).toBe('v_lead_list')
    // The selection is filtered by the list's own filters, not fetched whole
    // and narrowed afterwards.
    expect(calls.some(call => call.method === 'eq' && call.args[0] === 'lead_status')).toBe(true)
    expect(calls.some(call => call.method === 'or')).toBe(true)
    expect(calls.find(call => call.method === 'range')?.args).toEqual([0, 0])
    expect(page.rows).toEqual([
      { id: 'lead-1', name: 'Jane Doe', email: 'jane@example.com', phone: '617-555-0100' },
    ])
    expect(page.total).toBe(42)
    expect(page.truncated).toBe(true)
  })

  it('surfaces a query failure instead of returning an empty list', async () => {
    queryResult = { data: [], error: { message: 'view missing' }, count: null }
    await expect(fetchLeadExportRows(leadListParamsFrom({}))).rejects.toThrow('view missing')
  })
})
