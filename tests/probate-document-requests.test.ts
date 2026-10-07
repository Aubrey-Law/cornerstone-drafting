import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PROBATE_REQUEST_ITEMS,
  REQUEST_SECTIONS,
  existingRequestFor,
  groupRequestsBySection,
  planProbateSet,
  probateRequestItem,
  probateSetOptions,
  type RequestSection,
} from '@/lib/documentRequests/probateSet'

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => { throw new Error('no database in this test') } }))

/**
 * Probate intake: the standard list of what a personal representative is
 * asked for, sent as document requests in one step and grouped in the portal.
 * These pin that the list never asks twice for the same thing, that the
 * attorney's waiver sticks, and that the portal groups only when there is
 * something to group.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

type Existing = { title: string; status: 'requested' | 'received' | 'accepted' | 'waived'; templateKey: string | null }

describe('the standard list', () => {
  it('has unique keys the database will accept, each in a known section', () => {
    const keys = PROBATE_REQUEST_ITEMS.map(item => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const item of PROBATE_REQUEST_ITEMS) {
      expect(item.key).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
      expect(REQUEST_SECTIONS).toContain(item.section)
      expect(item.title.length).toBeLessThanOrEqual(160)
    }
  })

  it('covers the death certificate, the will, heirs, assets and debts, ticked by default', () => {
    for (const key of ['death_certificate', 'original_will', 'heirs_list', 'bank_statements', 'bills']) {
      expect(probateRequestItem(key)?.defaultSelected, key).toBe(true)
    }
    expect(probateRequestItem('mortgage')?.defaultSelected).toBe(false)
    expect(probateRequestItem('nope')).toBeNull()
  })
})

describe('never asking twice', () => {
  const certificate = probateRequestItem('death_certificate')!

  it('finds an earlier request made from the same item, even a waived one', () => {
    const waived: Existing = { title: 'Something renamed', status: 'waived', templateKey: 'death_certificate' }
    expect(existingRequestFor(certificate, [waived])).toBe(waived)
  })

  it('finds a live request typed by hand with the same title, but not a waived one', () => {
    const typed: Existing = { title: 'certified copy of the death certificate.', status: 'requested', templateKey: null }
    expect(existingRequestFor(certificate, [typed])).toBe(typed)
    expect(existingRequestFor(certificate, [{ ...typed, status: 'waived' }])).toBeNull()
  })

  it('plans only what is missing, in list order, and names what it skipped', () => {
    const existing: Existing[] = [{ title: 'x', status: 'accepted', templateKey: 'original_will' }]
    const plan = planProbateSet(['tax_returns', 'original_will', 'death_certificate'], existing)
    expect(plan.create.map(item => item.key)).toEqual(['death_certificate', 'tax_returns'])
    expect(plan.skipped).toEqual(['original_will'])
    expect(plan.unknown).toEqual([])
  })

  it('reports keys that are not on the list', () => {
    expect(planProbateSet(['death_certificate', 'pony'], []).unknown).toEqual(['pony'])
  })

  it('marks each option the matter already has', () => {
    const options = probateSetOptions([{ title: 'x', status: 'requested', templateKey: 'heirs_list' }])
    expect(options).toHaveLength(PROBATE_REQUEST_ITEMS.length)
    expect(options.find(option => option.key === 'heirs_list')?.alreadyRequested).toBe(true)
    expect(options.find(option => option.key === 'bills')?.alreadyRequested).toBe(false)
  })
})

describe('the portal list', () => {
  const row = (id: string, section: RequestSection | null) => ({ id, section })

  it('stays one ungrouped list when nothing came from a standard list', () => {
    expect(groupRequestsBySection([row('a', null), row('b', null)])).toEqual([{ section: null, label: '', requests: [row('a', null), row('b', null)] }])
    expect(groupRequestsBySection([])).toEqual([])
  })

  it('groups by section in the standard order, with one-off requests last', () => {
    const groups = groupRequestsBySection([row('1', 'debts'), row('2', null), row('3', 'death'), row('4', 'debts')])
    expect(groups.map(group => [group.section, group.label, group.requests.map(request => request.id)])).toEqual([
      ['death', 'Death certificate', ['3']],
      ['debts', 'What the estate owes', ['1', '4']],
      [null, 'Other requests', ['2']],
    ])
  })
})

describe('reading requests before the migration', () => {
  it('falls back to the columns that exist', async () => {
    const { listDocumentRequests } = await import('@/lib/documentRequests/repository')
    const selects: string[] = []
    const client = {
      from: () => ({
        select: (columns: string) => {
          selects.push(columns)
          const result = columns.includes('template_key')
            ? { data: null, error: { code: '42703', message: 'column document_requests.section does not exist' } }
            : { data: [{ id: 'r1', matter_id: 'm1', title: 'Deed', description: null, due_on: null, status: 'requested', source: 'staff', requested_at: '2026-10-01T00:00:00Z', received_document_id: null, received_at: null, accepted_at: null, waived_at: null, waived_reason: null }], error: null }
          const chain = { eq: () => chain, order: () => chain, limit: async () => result }
          return chain
        },
      }),
    }
    const requests = await listDocumentRequests('m1', client as never)
    expect(selects).toHaveLength(2)
    expect(requests).toEqual([expect.objectContaining({ id: 'r1', section: null, templateKey: null })])
  })
})

describe('wiring', () => {
  it('adds the section and item columns, with one row per item per matter', () => {
    const sql = read('supabase/migrations/20270124090000_probate_document_requests.sql')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS section text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS template_key text')
    expect(sql).toContain('ON public.document_requests (matter_id, template_key)')
    expect(sql).toContain(`section IN (${REQUEST_SECTIONS.map(section => `'${section}'`).join(', ')})`)
  })

  it('sends the list from the card on a probate matter, with one notice', () => {
    const route = read('app/api/admin/matters/[id]/document-requests/probate-list/route.ts')
    expect(route).toContain('requireAdmin(req)')
    expect(route).toContain('notifyClientOfDocumentRequest(id, created[0].title, created.length)')
    expect(read('app/admin/matters/[id]/RequestedDocumentsCard.tsx')).toContain('Ask for the probate documents')
    expect(read('app/admin/matters/[id]/MatterDetailClient.tsx')).toContain('probate={showProbate}')
    expect(read('app/(portal)/documents/RequestedDocuments.tsx')).toContain('groupRequestsBySection(requests)')
  })

  it('has generated types for the new columns', () => {
    const types = read('packages/db-types/src/supabase.generated.ts')
    const table = types.slice(types.indexOf('      document_requests: {'), types.indexOf('      document_requests: {') + 3000)
    expect(table).toContain('section: string | null')
    expect(table).toContain('template_key: string | null')
  })
})
