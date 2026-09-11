import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isClosedMatter } from '@/lib/matters/closedMatter'
import { filterAndSortMatters, matterTableFiltersFrom } from '@/lib/adminTables/matterTable'
import { matterPageParams } from '@/lib/matters/pageParams'
import type { MatterListRow } from '@/lib/queries/matters'

/**
 * Closed matters are finished work: nothing on one is waiting for anybody, and
 * every month the firm ran, the lists it works from got longer without getting
 * more useful. They come out of Matters and out of the drafting worklist — and
 * because a matter is closed along either of two axes (the Close-out card moves
 * the stage, the details card sets the status), both have to be read.
 */

function row(overrides: Partial<MatterListRow>): MatterListRow {
  return {
    matter_id: overrides.matter_id ?? 'matter-1',
    matter_name: 'Smith Family',
    stage: 'drafting',
    status: 'active',
    flags: null,
    matter_created: '2026-07-01T12:00:00Z',
    client_name: 'Ada Smith',
    client_email: 'ada@example.test',
    client_phone: '',
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
    ...overrides,
  } as MatterListRow
}

describe('what counts as a closed matter', () => {
  it.each([
    ['closed by status', { status: 'closed', stage: 'drafting' }, true],
    ['archived', { status: 'archived', stage: 'drafting' }, true],
    ['closed by stage', { status: 'active', stage: 'closed' }, true],
    ['on hold', { status: 'on_hold', stage: 'drafting' }, false],
    ['running', { status: 'active', stage: 'funding' }, false],
  ])('%s', (_label, matter, expected) => {
    expect(isClosedMatter(matter)).toBe(expected)
  })
})

describe('the matters list', () => {
  const matters = [
    row({ matter_id: 'open' }),
    row({ matter_id: 'closed-by-status', status: 'closed' }),
    row({ matter_id: 'closed-by-stage', stage: 'closed' }),
  ]

  it('leaves closed matters out by default', () => {
    const shown = filterAndSortMatters(matters, matterTableFiltersFrom({}), 'client_asc')
    expect(shown.map(m => m.matter_id)).toEqual(['open'])
  })

  it('brings them back when the Closed toggle is on', () => {
    const shown = filterAndSortMatters(matters, matterTableFiltersFrom({ closed: '1' }), 'client_asc')
    expect(shown.map(m => m.matter_id).sort()).toEqual(['closed-by-stage', 'closed-by-status', 'open'])
  })

  it('reads the toggle off the URL, and only an explicit yes counts', () => {
    expect(matterPageParams({ closed: '1' }).filters.includeClosed).toBe(true)
    expect(matterPageParams({}).filters.includeClosed).toBe(false)
    expect(matterPageParams({ closed: 'maybe' }).filters.includeClosed).toBe(false)
  })
})

describe('the database reads behind both lists', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20261128000000_hide_closed_matters.sql'),
    'utf8',
  )

  it('hides closed matters from the matters page unless the query asks for them', () => {
    expect(migration).toContain("coalesce(p_query->>'closed','hide')='show'")
    expect(migration).toContain("v.status not in ('closed','archived') and v.stage<>'closed'")
  })

  it('drops a closed matter from the drafting worklist, toggle or no toggle', () => {
    // The stage filter already missed this row: a matter closed by status while
    // its stage still read `drafting` sat in the worklist forever.
    expect(migration).toContain("and coalesce(v.status, '') not in ('closed', 'archived')")
  })

  it('sends the toggle the page is showing to the database', () => {
    const query = fs.readFileSync(path.join(process.cwd(), 'lib/queries/matters.ts'), 'utf8')
    expect(query).toContain("closed:params.filters.includeClosed ? 'show' : 'hide'")
  })
})
