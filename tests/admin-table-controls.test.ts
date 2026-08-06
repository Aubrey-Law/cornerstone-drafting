import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEAD_TABLE_FILTERS,
  filterAndSortLeads,
  type LeadTableRow,
} from '@/lib/adminTables/leadTable'
import {
  EMPTY_MATTER_TABLE_FILTERS,
  filterAndSortMatters,
  matterLastActivityAt,
} from '@/lib/adminTables/matterTable'
import type { MatterListRow } from '@/lib/queries/matters'

const ids = (rows: LeadTableRow[]) => rows.map(row => row.id)

const leads: LeadTableRow[] = [
  { id: 'new', full_name: 'New Lead', first_name: 'New', last_name: 'Lead', email: 'new@example.com', phone: '617-555-0100', practice_area: 'Estate Planning', status: 'draft', intake_sent_at: null, intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 1000, created_at: '2026-07-01T00:00:00Z', last_activity_at: '2026-07-02T00:00:00Z' },
  { id: 'intake-sent', full_name: 'Intake Sent', first_name: 'Intake', last_name: 'Sent', email: 'intake@example.com', phone: '617-555-0101', practice_area: 'Probate', status: 'draft', intake_sent_at: '2026-07-03T00:00:00Z', intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 2000, created_at: '2026-07-03T00:00:00Z', last_activity_at: '2026-07-04T00:00:00Z' },
  { id: 'intake-done', full_name: 'Intake Done', first_name: 'Intake', last_name: 'Done', email: 'done@example.com', phone: '617-555-0102', practice_area: 'Elder Law', status: 'completed', intake_sent_at: '2026-07-23T00:00:00Z', intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 3000, created_at: '2026-07-23T00:00:00Z', last_activity_at: '2026-07-24T00:00:00Z' },
  { id: 'agreement-sent', full_name: 'Agreement Sent', first_name: 'Agreement', last_name: 'Sent', email: 'agreement@example.com', phone: '617-555-0103', practice_area: 'Estate Planning', status: 'completed', intake_sent_at: '2026-07-20T00:00:00Z', intake_completed_at: '2026-07-21T00:00:00Z', engagement_status: 'sent', engagement_sent_at: '2026-07-22T00:00:00Z', engagement_fee_quoted: 4000, created_at: '2026-07-20T00:00:00Z', last_activity_at: '2026-07-22T00:00:00Z' },
  { id: 'signed', full_name: 'Signed Agreement', first_name: 'Signed', last_name: 'Agreement', email: 'signed@example.com', phone: '617-555-0104', practice_area: 'Probate', status: 'completed', intake_sent_at: '2026-07-17T00:00:00Z', intake_completed_at: '2026-07-18T00:00:00Z', engagement_status: 'signed', engagement_sent_at: '2026-07-19T00:00:00Z', engagement_fee_quoted: 5000, created_at: '2026-07-17T00:00:00Z', last_activity_at: '2026-07-19T00:00:00Z' },
  { id: 'smith', full_name: null, first_name: 'Sam', last_name: 'Smith', email: 'smith@example.com', phone: '617-555-0105', practice_area: 'Estate Planning', status: 'lost', intake_sent_at: null, intake_completed_at: null, engagement_status: null, engagement_sent_at: null, engagement_fee_quoted: 6000, created_at: '2026-07-15T00:00:00Z', last_activity_at: '2026-07-16T00:00:00Z' },
]

const canonicalPracticeLeads: LeadTableRow[] = [
  {
    id: 'canonical-ep',
    full_name: 'Taylor Planner',
    first_name: 'Taylor',
    last_name: 'Planner',
    email: 'taylor@planning.test',
    phone: '617-555-0191',
    practice_area: 'EP',
    status: 'draft',
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-07-10T00:00:00Z',
    last_activity_at: null,
  },
  {
    id: 'canonical-ep-lp',
    full_name: 'Jordan Lane',
    first_name: 'Jordan',
    last_name: 'Lane',
    email: 'jordan@legacy.test',
    phone: '617-555-0192',
    practice_area: 'EP-LP',
    status: 'draft',
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-07-11T00:00:00Z',
    last_activity_at: null,
  },
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
  it.each([
    ['name', 'Taylor Planner', ['canonical-ep']],
    ['email', 'jordan@legacy.test', ['canonical-ep-lp']],
    ['phone', '617-555-0191', ['canonical-ep']],
    ['provisional number', '2026-EPLP-Lane', ['canonical-ep-lp']],
    ['raw practice code', 'EP-LP', ['canonical-ep-lp']],
    ['displayed EP-LP practice label', 'Estate Planning - LP', ['canonical-ep-lp']],
    ['displayed practice label across canonical EP and EP-LP rows', 'Estate Planning', ['canonical-ep-lp', 'canonical-ep']],
  ] as const)('searches by %s (catches missing user-visible lead search fields)', (_field, search, want) => {
    expect(ids(filterAndSortLeads(canonicalPracticeLeads, {
      ...EMPTY_LEAD_TABLE_FILTERS,
      search,
    }, 'newest'))).toEqual(want)
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

const matterIds = (rows: MatterListRow[]) => rows.map(row => row.matter_id)

const matterRow = (matter_id: string, fields: Partial<MatterListRow>): MatterListRow => ({
  matter_id,
  matter_name: 'Estate Plan',
  stage: 'intake',
  status: 'open',
  flags: null,
  matter_created: null as unknown as string,
  client_name: 'Client',
  client_email: 'client@example.com',
  client_phone: '617-555-0100',
  client_dob: null,
  client_address: null,
  spouse_name: null,
  spouse_email: null,
  spouse_phone: null,
  spouse_dob: null,
  spouse_address: null,
  plan_type: null,
  marital_status: null,
  has_minor_children: null,
  taxable_estate: null,
  intake_status: null,
  design_status: null,
  intake_submitted_at: null,
  drafts_sent_at: null,
  signing_date: null,
  documents_executed_at: null,
  next_appointment: null,
  next_appointment_type: null,
  referral_source: null,
  fee_amount: null,
  opened_at: null,
  matter_number: null,
  ...fields,
})

const matters: MatterListRow[] = [
  matterRow('matching-matter', {
    matter_name: 'Smith Family Trust',
    client_name: 'Sam Smith',
    practice_area: 'EP',
    stage: 'design',
    matter_created: '2026-07-01T00:00:00Z',
  }),
  matterRow('wrong-practice', {
    matter_name: 'Smith Probate Matter',
    client_name: 'Sam Smith',
    practice_area: 'Probate',
    stage: 'design',
    matter_created: '2026-07-02T00:00:00Z',
  }),
  matterRow('wrong-stage', {
    matter_name: 'Smith Intake',
    client_name: 'Sam Smith',
    practice_area: 'EP',
    stage: 'intake',
    matter_created: '2026-07-03T00:00:00Z',
  }),
]

const matterSortFixtures = {
  last_activity: [
    matterRow('recent', { matter_created: '2026-07-01T00:00:00Z', intake_submitted_at: '2026-07-03T00:00:00Z' }),
    matterRow('stale', { matter_created: '2026-07-01T00:00:00Z' }),
    matterRow('missing', { matter_created: null as unknown as string }),
  ],
  newest: [
    matterRow('newest', { matter_created: '2026-07-03T00:00:00Z' }),
    matterRow('older', { matter_created: '2026-07-01T00:00:00Z' }),
    matterRow('missing', { matter_created: null as unknown as string }),
  ],
  oldest: [
    matterRow('newest', { matter_created: '2026-07-03T00:00:00Z' }),
    matterRow('older', { matter_created: '2026-07-01T00:00:00Z' }),
    matterRow('missing', { matter_created: null as unknown as string }),
  ],
  client_asc: [
    matterRow('alpha', { client_name: 'Alpha' }),
    matterRow('zulu', { client_name: 'Zulu' }),
    matterRow('missing', { client_name: null as unknown as string }),
  ],
  client_desc: [
    matterRow('alpha', { client_name: 'Alpha' }),
    matterRow('zulu', { client_name: 'Zulu' }),
    matterRow('missing', { client_name: null as unknown as string }),
  ],
  matter_number: [
    matterRow('number-010', { matter_number: '010' }),
    matterRow('number-001', { matter_number: '001' }),
    matterRow('missing', {}),
  ],
} satisfies Record<string, MatterListRow[]>

const matterWithSeveralDates = matterRow('several-dates', {
  matter_created: '2026-07-20T12:00:00Z',
  intake_submitted_at: '2026-07-22T12:00:00Z',
  drafts_sent_at: '2026-07-23T12:00:00Z',
  documents_executed_at: '2026-07-24T12:00:00Z',
})

describe('matter table controls', () => {
  it('keeps matter search, practice, and stage-group filtering composed', () => {
    expect(matterIds(filterAndSortMatters(matters, {
      search: 'smith',
      practice: 'EP',
      stageGroup: 'active',
    }, 'last_activity'))).toEqual(['matching-matter'])
  })

  it.each([
    ['last_activity', ['recent', 'stale', 'missing']],
    ['newest', ['newest', 'older', 'missing']],
    ['oldest', ['older', 'newest', 'missing']],
    ['client_asc', ['alpha', 'zulu', 'missing']],
    ['client_desc', ['zulu', 'alpha', 'missing']],
    ['matter_number', ['number-001', 'number-010', 'missing']],
  ] as const)('sorts matters by %s with missing values last', (sort, want) => {
    expect(matterIds(filterAndSortMatters(
      matterSortFixtures[sort],
      EMPTY_MATTER_TABLE_FILTERS,
      sort,
    ))).toEqual(want)
  })

  it('derives last activity from the newest timestamp carried by the pipeline view', () => {
    expect(matterLastActivityAt(matterWithSeveralDates))
      .toBe(Date.parse('2026-07-24T12:00:00Z'))
  })

  it('does not mutate the input matter array', () => {
    const original = [...matterSortFixtures.client_asc]
    filterAndSortMatters(matterSortFixtures.client_asc, EMPTY_MATTER_TABLE_FILTERS, 'client_asc')
    expect(matterSortFixtures.client_asc).toEqual(original)
  })
})
