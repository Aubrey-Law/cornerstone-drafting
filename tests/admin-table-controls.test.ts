import { describe, expect, it } from 'vitest'
// The lead half of this file moved to tests/lead-list-params.test.ts and
// tests/lead-score-sql-parity.test.ts when lead filtering, sorting and ranking
// moved into v_lead_list (20261014000000).
import {
  EMPTY_MATTER_TABLE_FILTERS,
  filterAndSortMatters,
  matterLastActivityAt,
} from '@/lib/adminTables/matterTable'
import type { MatterListRow } from '@/lib/queries/matters'

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
