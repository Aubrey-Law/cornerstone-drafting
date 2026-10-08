import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))

import {
  MATTER_SECTIONS,
  isMatterSection,
  loadMatterDossier,
  resolveRecordMatterId,
  searchMatterRecords,
} from '@/lib/matterKnowledge'

/**
 * A stand-in for one PostgREST query: every filter/order/limit returns `this`,
 * and awaiting it (or calling maybeSingle) yields whatever the table was seeded
 * with. Enough to exercise the loaders without a database.
 */
function queryFor(rows: unknown[], error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = async () => ({ data: rows[0] ?? null, error })
  builder.single = async () => ({ data: rows[0] ?? null, error })
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: error ? null : rows, error }).then(resolve)
  return builder
}

function seed(tables: Record<string, unknown[] | { error: string }>) {
  mocks.from.mockImplementation((table: string) => {
    const entry = tables[table]
    if (entry && !Array.isArray(entry)) return queryFor([], { message: entry.error })
    return queryFor(entry ?? [])
  })
}

const MATTER_ROW = {
  id: 'matter-1',
  matter_number: '2026-014',
  name: 'Chen Trust',
  stage: 'drafting',
  status: 'active',
  relationship_status: 'hired',
  created_at: '2026-01-05T00:00:00Z',
}

describe('matter sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed({})
  })

  it('accepts only the sections it can actually load', () => {
    for (const section of MATTER_SECTIONS) expect(isMatterSection(section)).toBe(true)
    expect(isMatterSection('payroll')).toBe(false)
    expect(isMatterSection(undefined)).toBe(false)
  })

  it('reads the overview from the matter, pipeline and details rows together', async () => {
    seed({
      matters: [MATTER_ROW],
      v_matter_pipeline: [{ client_name: 'Wei Chen', client_email: 'wei@example.com', practice_area: 'EP' }],
      matter_details: [{ legal_plan: 'metlife', ep_plan_category: 'trust' }],
    })

    const dossier = await loadMatterDossier('matter-1', ['overview'])
    const overview = dossier.sections[0]

    expect(dossier.matter_label).toBe('Chen Trust · #2026-014')
    expect(overview).toMatchObject({
      section: 'overview',
      matter_number: '2026-014',
      record_type: 'matter',
      client_name: 'Wei Chen',
      legal_plan: 'metlife',
      plan_type: 'trust',
    })
  })

  it('gives the assistant the same canonical lifecycle action and blockers as record views', async () => {
    seed({
      matters: [MATTER_ROW],
      v_matter_pipeline: [{
        matter_id: 'matter-1', matter_name: 'Chen Trust', stage: 'intake', status: 'active',
        practice_area: 'EP', intake_status: null, intake_sent_at: null,
        intake_submitted_at: null, design_status: null,
      }],
      matter_details: [],
      design_sheets: [],
    })

    const [lifecycle] = (await loadMatterDossier('matter-1', ['lifecycle'])).sections

    expect(lifecycle.next_action).toMatchObject({ kind: 'draft' })
    expect(lifecycle.operational_brief).toMatchObject({
      blockers: [],
    })
  })

  it('reports billing in dollars, not the cents the ledger stores', async () => {
    seed({
      matters: [MATTER_ROW],
      billing_items: [
        { id: 'item-1', kind: 'flat_fee', label: 'Trust package', amount_billed: 450_000, status: 'invoiced' },
      ],
      billing_payments: [{ billing_item_id: 'item-1', amount: 200_000, method: 'check', received_at: '2026-02-01' }],
      invoices: [{ id: 'inv-1', number: '2026-3', kind: 'invoice', status: 'partial', subtotal_cents: 450_000 }],
    })

    const [billing] = (await loadMatterDossier('matter-1', ['billing'])).sections

    expect(billing).toMatchObject({
      total_billed: 4500,
      total_collected: 2000,
      outstanding: 2500,
    })
    expect((billing.charges as Array<{ amount: number }>)[0].amount).toBe(4500)
    expect((billing.invoices as Array<{ amount: number }>)[0].amount).toBe(4500)
  })

  it('names the folder each document sits in, stored or derived', async () => {
    seed({
      matters: [MATTER_ROW],
      matter_document_folders: [{ id: 'folder-1', name: 'Deed work' }],
      matter_documents: [
        { id: 'doc-1', name: 'Deed.pdf', source: 'firm', folder_id: 'folder-1', size: 10, created_at: 'x' },
        { id: 'doc-2', name: 'Bank statement.pdf', source: 'client', folder_id: null, size: 10, created_at: 'x' },
        { id: 'doc-3', name: 'Letter.pdf', source: 'firm', folder_id: null, size: 10, created_at: 'x' },
      ],
    })

    const [documents] = (await loadMatterDossier('matter-1', ['documents'])).sections
    const rows = documents.documents as Array<{ document_id: string; folder: string | null }>

    expect(documents.folders).toEqual(['Deed work'])
    expect(rows.map(row => row.folder)).toEqual(['Deed work', 'client-uploads', null])
    // The id is what read_document_text takes, so every row has to carry it.
    expect(rows.every(row => typeof row.document_id === 'string')).toBe(true)
  })

  it('keeps a failed section from taking the rest of the record down', async () => {
    seed({
      matters: [MATTER_ROW],
      matter_notes: { error: 'relation "matter_notes" does not exist' },
      tasks: [{ id: 't-1', title: 'Send drafts', status: 'open', priority: 'high' }],
    })

    const dossier = await loadMatterDossier('matter-1', ['notes', 'tasks'])
    const notes = dossier.sections.find(section => section.section === 'notes')
    const tasks = dossier.sections.find(section => section.section === 'tasks')

    expect(notes?.error).toContain('matter_notes')
    expect(tasks?.error).toBeUndefined()
    expect(tasks?.open_count).toBe(1)
  })

  it('defaults to the overview when no section is named', async () => {
    seed({ matters: [MATTER_ROW] })
    const dossier = await loadMatterDossier('matter-1', [])
    expect(dossier.sections.map(section => section.section)).toEqual(['overview'])
  })
})

describe('resolving a record id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a matter id unchanged', async () => {
    seed({ matters: [{ id: 'matter-1' }] })
    expect(await resolveRecordMatterId('matter-1')).toBe('matter-1')
  })

  it('follows a lead id through to the matter that owns it', async () => {
    seed({ matters: [], client_intake: [{ matter_id: 'matter-7' }] })
    expect(await resolveRecordMatterId('lead-1')).toBe('matter-7')
  })

  it('returns null for an id that is neither', async () => {
    seed({ matters: [], client_intake: [] })
    expect(await resolveRecordMatterId('nonsense')).toBeNull()
  })
})

describe('searching for a matter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not query at all for an empty term', async () => {
    seed({})
    expect(await searchMatterRecords('   ')).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('marks an unhired record as a lead and carries its matter number', async () => {
    seed({
      v_matter_pipeline: [
        { matter_id: 'matter-1', matter_name: 'Chen Trust', client_name: 'Wei Chen', stage: 'drafting' },
        { matter_id: 'matter-2', matter_name: 'Chen consult', client_name: 'Wei Chen', stage: 'new' },
      ],
      matters: [
        { id: 'matter-1', matter_number: '2026-014', relationship_status: 'hired' },
        { id: 'matter-2', matter_number: null, relationship_status: 'prospect' },
      ],
    })

    const results = await searchMatterRecords('Chen')

    expect(results.map(row => row.type)).toEqual(['matter', 'lead'])
    expect(results[0]).toMatchObject({ matter_number: '2026-014', url: '/admin/matters/matter-1' })
  })
})
