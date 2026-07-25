import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEAD_TABLE_FILTERS,
  filterAndSortLeads,
  type LeadTableRow,
} from '@/lib/adminTables/leadTable'

const ids = (rows: LeadTableRow[]) => rows.map(row => row.id)

const leads: LeadTableRow[] = [
  { id: 'new', full_name: 'New Lead', first_name: 'New', last_name: 'Lead', email: 'new@example.com', phone: '617-555-0100', practice_area: 'Estate Planning', status: 'draft', intake_sent_at: null, intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 1000, created_at: '2026-07-01T00:00:00Z', last_activity_at: '2026-07-02T00:00:00Z' },
  { id: 'intake-sent', full_name: 'Intake Sent', first_name: 'Intake', last_name: 'Sent', email: 'intake@example.com', phone: '617-555-0101', practice_area: 'Probate', status: 'draft', intake_sent_at: '2026-07-03T00:00:00Z', intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 2000, created_at: '2026-07-03T00:00:00Z', last_activity_at: '2026-07-04T00:00:00Z' },
  { id: 'intake-done', full_name: 'Intake Done', first_name: 'Intake', last_name: 'Done', email: 'done@example.com', phone: '617-555-0102', practice_area: 'Elder Law', status: 'completed', intake_sent_at: '2026-07-23T00:00:00Z', intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 3000, created_at: '2026-07-23T00:00:00Z', last_activity_at: '2026-07-24T00:00:00Z' },
  { id: 'agreement-sent', full_name: 'Agreement Sent', first_name: 'Agreement', last_name: 'Sent', email: 'agreement@example.com', phone: '617-555-0103', practice_area: 'Estate Planning', status: 'completed', intake_sent_at: '2026-07-20T00:00:00Z', intake_completed_at: '2026-07-21T00:00:00Z', engagement_status: 'sent', engagement_sent_at: '2026-07-22T00:00:00Z', engagement_fee_quoted: 4000, created_at: '2026-07-20T00:00:00Z', last_activity_at: '2026-07-22T00:00:00Z' },
  { id: 'signed', full_name: 'Signed Agreement', first_name: 'Signed', last_name: 'Agreement', email: 'signed@example.com', phone: '617-555-0104', practice_area: 'Probate', status: 'completed', intake_sent_at: '2026-07-17T00:00:00Z', intake_completed_at: '2026-07-18T00:00:00Z', engagement_status: 'signed', engagement_sent_at: '2026-07-19T00:00:00Z', engagement_fee_quoted: 5000, created_at: '2026-07-17T00:00:00Z', last_activity_at: '2026-07-19T00:00:00Z' },
  { id: 'smith', full_name: null, first_name: 'Sam', last_name: 'Smith', email: 'smith@example.com', phone: '617-555-0105', practice_area: 'Estate Planning', status: 'lost', intake_sent_at: null, intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 6000, created_at: '2026-07-15T00:00:00Z', last_activity_at: '2026-07-16T00:00:00Z' },
]

const sortRow = (id: string, fields: Partial<LeadTableRow>): LeadTableRow => ({
  id, full_name: null, first_name: null, last_name: null, email: null, phone: null,
  practice_area: null, status: 'draft', intake_sent_at: null, intake_completed_at: null,
  engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: null,
  created_at: null, last_activity_at: null, ...fields,
})

const sortFixtures = {
  newest: [sortRow('newest', { created_at: '2026-07-03T00:00:00Z' }), sortRow('older', { created_at: '2026-07-01T00:00:00Z' }), sortRow('missing', {})],
  oldest: [sortRow('newest', { created_at: '2026-07-03T00:00:00Z' }), sortRow('older', { created_at: '2026-07-01T00:00:00Z' }), sortRow('missing', {})],
  name_asc: [sortRow('alpha', { full_name: 'Alpha' }), sortRow('zulu', { full_name: 'Zulu' }), sortRow('missing', {})],
  name_desc: [sortRow('alpha', { full_name: 'Alpha' }), sortRow('zulu', { full_name: 'Zulu' }), sortRow('missing', {})],
  fee_desc: [sortRow('high', { engagement_fee_quoted: 9000 }), sortRow('low', { engagement_fee_quoted: 1000 }), sortRow('missing', {})],
  last_activity: [sortRow('recent', { last_activity_at: '2026-07-03T00:00:00Z' }), sortRow('stale', { last_activity_at: '2026-07-01T00:00:00Z' }), sortRow('missing', {})],
} satisfies Record<string, LeadTableRow[]>

describe('lead table controls', () => {
  it('searches lead identity fields including provisional number (catches wrong field coverage)', () => {
    expect(ids(filterAndSortLeads(leads, {
      ...EMPTY_LEAD_TABLE_FILTERS,
      search: '2026-EP-Smith',
    }, 'newest'))).toEqual(['smith'])
  })

  it.each([
    ['intake_not_sent', ['new']],
    ['intake_pending', ['intake-sent']],
    ['intake_complete', ['intake-done', 'agreement-sent', 'signed']],
    ['engagement_pending', ['agreement-sent']],
    ['engagement_signed', ['signed']],
  ] as const)('filters %s progress (catches overlapping progress rules)', (progress, want) => {
    expect(ids(filterAndSortLeads(leads, {
      ...EMPTY_LEAD_TABLE_FILTERS,
      progress,
    }, 'newest'))).toEqual(want)
  })

  it.each([
    ['newest', ['newest', 'older', 'missing']],
    ['oldest', ['older', 'newest', 'missing']],
    ['name_asc', ['alpha', 'zulu', 'missing']],
    ['name_desc', ['zulu', 'alpha', 'missing']],
    ['fee_desc', ['high', 'low', 'missing']],
    ['last_activity', ['recent', 'stale', 'missing']],
  ] as const)('sorts leads by %s with missing values last (catches wrong direction and missing values promoted above real values)', (sort, want) => {
    expect(ids(filterAndSortLeads(sortFixtures[sort], EMPTY_LEAD_TABLE_FILTERS, sort))).toEqual(want)
  })

  it('does not mutate the input lead array (catches in-place .sort() mutation)', () => {
    const original = [...sortFixtures.name_asc]
    filterAndSortLeads(sortFixtures.name_asc, EMPTY_LEAD_TABLE_FILTERS, 'name_asc')
    expect(sortFixtures.name_asc).toEqual(original)
  })
})
