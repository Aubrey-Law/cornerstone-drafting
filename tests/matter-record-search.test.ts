import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A tiny PostgREST stand-in over in-memory rows: enough of the query builder
 * (select / or / in / eq / limit / order / maybeSingle) for the record search.
 */
type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}

function matchesIlike(value: unknown, pattern: string) {
  const needle = pattern.replace(/^%|%$/g, '').replace(/\\([%_])/g, '$1').toLowerCase()
  return typeof value === 'string' && value.toLowerCase().includes(needle)
}

function builder(table: string) {
  let rows = [...(tables[table] ?? [])]
  const chain = {
    select: () => chain,
    order: () => chain,
    or: (expr: string) => {
      const clauses = expr.split(',').map(clause => {
        const [column, op, ...rest] = clause.split('.')
        return { column, op, value: rest.join('.') }
      })
      rows = rows.filter(row => clauses.some(({ column, op, value }) => op === 'ilike' ? matchesIlike(row[column], value) : row[column] === value))
      return chain
    },
    in: (column: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[column])); return chain },
    eq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] === value); return chain },
    not: (column: string, _op: string, value: unknown) => { rows = rows.filter(row => row[column] !== value); return chain },
    limit: (n: number) => { rows = rows.slice(0, n); return chain },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return chain
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: builder }) }))
vi.mock('@/lib/documentWorkspace', () => ({ documentFolderId: () => null }))

import { describeRecord, loadMatterDossier, searchMatterRecords } from '@/lib/matterKnowledge'

beforeEach(() => {
  tables.client_intake = [
    { id: 'ci-hired', first_name: 'Amy', last_name: 'Chen', full_name: 'Amy Chen', email: 'amy@example.com', phone: '617-555-0100', lead_status: 'hired', matter_id: 'm-hired' },
    { id: 'ci-lead', first_name: 'Bob', last_name: 'Lee', full_name: 'Bob Lee', email: 'bob@example.com', phone: null, lead_status: 'lead', matter_id: 'm-lead' },
    { id: 'ci-orphan', first_name: 'Cara', last_name: 'Diaz', full_name: 'Cara Diaz', email: 'cara@example.com', phone: null, lead_status: 'lead', matter_id: null },
  ]
  tables.matters = [
    { id: 'm-hired', name: 'Chen Family Trust', matter_number: '00-001', relationship_status: 'hired', stage: 'design', status: 'active', client_intake_id: 'ci-hired', created_at: '2026-01-01T00:00:00Z' },
    { id: 'm-lead', name: 'Lee — Opportunity', matter_number: null, relationship_status: 'lead', stage: 'intake', status: 'open', client_intake_id: 'ci-lead', created_at: '2026-02-01T00:00:00Z' },
  ]
  // The pipeline view carries hired matters only — the reason leads went missing.
  tables.v_matter_pipeline = [
    { matter_id: 'm-hired', matter_name: 'Chen Family Trust', client_name: 'Amy Chen', client_email: 'amy@example.com', stage: 'design', status: 'active' },
  ]
  tables.matter_details = []
})

/**
 * The search read the pipeline view, which holds hired matters only. In the
 * firm database that hid 61 lead matters, 10 lost ones and 5 leads with no
 * matter yet from find_matter, the chat's record picker and the chat header.
 */
describe('finding leads and opportunities', () => {
  it('finds a lead by the client’s name and points at the opportunity page', async () => {
    const [record] = await searchMatterRecords('lee')
    expect(record).toMatchObject({ type: 'lead', id: 'ci-lead', client_name: 'Bob Lee', url: '/admin/crm/opportunities/ci-lead', matter_number: null })
  })

  it('finds a lead that has no matter yet', async () => {
    const [record] = await searchMatterRecords('cara')
    expect(record).toMatchObject({ type: 'lead', id: 'ci-orphan', label: 'Cara Diaz', url: '/admin/crm/opportunities/ci-orphan' })
  })

  it('still finds a hired matter by matter name, matter number, or client', async () => {
    for (const term of ['Chen Family', '00-001', 'amy@example']) {
      const records = await searchMatterRecords(term)
      expect(records.map(r => r.id), term).toEqual(['m-hired'])
      expect(records[0]).toMatchObject({ type: 'matter', url: '/admin/matters/m-hired', matter_number: '00-001', client_name: 'Amy Chen' })
    }
  })

  it('returns one row when both the client and the matter name match', async () => {
    const records = await searchMatterRecords('chen')
    expect(records).toHaveLength(1)
  })

  it('finds by email for a lead too', async () => {
    const [record] = await searchMatterRecords('bob@')
    expect(record?.id).toBe('ci-lead')
  })
})

describe('labelling a record for the chat header', () => {
  it('names a lead and links to its opportunity', async () => {
    expect(await describeRecord('ci-lead')).toEqual({ id: 'ci-lead', type: 'lead', label: 'Lee — Opportunity', url: '/admin/crm/opportunities/ci-lead' })
  })

  it('names a lead that has no matter yet', async () => {
    expect(await describeRecord('ci-orphan')).toEqual({ id: 'ci-orphan', type: 'lead', label: 'Cara Diaz', url: '/admin/crm/opportunities/ci-orphan' })
  })

  it('names a hired matter with its number', async () => {
    expect(await describeRecord('m-hired')).toEqual({ id: 'm-hired', type: 'matter', label: 'Chen Family Trust · #00-001', url: '/admin/matters/m-hired' })
  })
})

describe('reading a lead’s overview', () => {
  it('still names the client when the pipeline view has no row for the lead', async () => {
    const dossier = await loadMatterDossier('m-lead', ['overview'])
    const overview = dossier.sections[0] as Record<string, unknown>
    expect(overview.record_type).toBe('lead')
    expect(overview.client_name).toBe('Bob Lee')
    expect(overview.client_email).toBe('bob@example.com')
  })
})
