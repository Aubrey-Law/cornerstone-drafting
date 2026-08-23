import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLeadSearchFilter,
  clampShow,
  EMPTY_LEAD_LIST_PARAMS,
  LEAD_PAGE_SIZE,
  MAX_LEAD_PAGE_SIZE,
} from '@/lib/leads/listParams'

describe('lead search translation', () => {
  // The fields a reader expects to be able to search by. This list is what the
  // old client-side search covered; the point of the translation is that none
  // of them stopped working when the search moved to the database.
  it.each([
    ['name', 'Taylor', ['full_name.ilike.*Taylor*', 'first_name.ilike.*Taylor*', 'last_name.ilike.*Taylor*']],
    ['email', 'jordan@legacy.test', ['email.ilike.*jordan@legacy.test*']],
    ['phone', '617-555-0191', ['phone.ilike.*617-555-0191*']],
    ['raw practice code', 'EP-LP', ['practice_area.eq.EP-LP']],
    ['displayed practice label', 'Estate Planning - LP', ['practice_area.eq.EP-LP']],
    ['provisional number', '2026-EPLP-Lane', ['last_name.ilike.*Lane*', 'practice_area.eq.EP-LP']],
  ] as const)('searches by %s (catches a user-visible search field lost in the move to SQL)', (_field, search, want) => {
    const filter = buildLeadSearchFilter(search) ?? ''
    for (const clause of want) expect(filter).toContain(clause)
  })

  it('matches the columns a name, an email or a phone could be in', () => {
    const filter = buildLeadSearchFilter('jane') ?? ''
    for (const column of ['full_name', 'first_name', 'last_name', 'email', 'phone']) {
      expect(filter).toContain(`${column}.ilike.*jane*`)
    }
  })

  it('turns a practice area the reader typed into its code', () => {
    // "Estate Planning" is a label, not a column value; the column holds "EP".
    expect(buildLeadSearchFilter('Estate Planning')).toContain('practice_area.eq.EP')
    expect(buildLeadSearchFilter('probate')).toContain('practice_area.eq.Probate')
    expect(buildLeadSearchFilter('College Preparation Plan')).toContain('practice_area.eq.CP')
  })

  it('leaves a hyphenated phone number whole, rather than searching for its area code', () => {
    const filter = buildLeadSearchFilter('617-555-0191') ?? ''
    expect(filter).toContain('phone.ilike.*617-555-0191*')
    expect(filter).not.toContain('ilike.*617*,')
    expect(filter).not.toContain('.ilike.*555*')
  })

  it('splits a provisional lead number into the parts a column holds', () => {
    // The table shows "2026-EP-Smith"; only the last name and the code exist.
    const filter = buildLeadSearchFilter('2026-EP-Smith') ?? ''
    expect(filter).toContain('last_name.ilike.*Smith*')
    expect(filter).toContain('practice_area.eq.EP')
    // The year is not text on any row, so it is not searched for as text.
    expect(filter).not.toContain('ilike.*2026*')
  })

  it('neutralises the characters that would end a PostgREST term', () => {
    // Without this, a comma reads as the next filter rather than as text.
    const filter = buildLeadSearchFilter('Smith, Jane (ref)') ?? ''
    expect(filter).not.toContain('Smith,')
    expect(filter).not.toContain('(ref)')
    expect(filter).toContain('full_name.ilike.*Smith  Jane  ref *')
  })

  it('is null for an empty search, so no filter is applied at all', () => {
    expect(buildLeadSearchFilter('')).toBeNull()
    expect(buildLeadSearchFilter('   ')).toBeNull()
  })
})

describe('page size', () => {
  it('never asks for less than a page or more than the ceiling', () => {
    expect(clampShow(undefined)).toBe(LEAD_PAGE_SIZE)
    expect(clampShow(Number.NaN)).toBe(LEAD_PAGE_SIZE)
    expect(clampShow(1)).toBe(LEAD_PAGE_SIZE)
    expect(clampShow(-40)).toBe(LEAD_PAGE_SIZE)
    expect(clampShow(120)).toBe(120)
    // A hand-edited URL cannot turn the page back into "load everything".
    expect(clampShow(50_000)).toBe(MAX_LEAD_PAGE_SIZE)
  })

  it('defaults to one page', () => {
    expect(EMPTY_LEAD_LIST_PARAMS.show).toBe(LEAD_PAGE_SIZE)
    expect(EMPTY_LEAD_LIST_PARAMS.status).toBe('open')
  })
})

describe('the leads query', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/queries/leadList.ts'), 'utf8')

  it('orders by a column for every sort the list offers', () => {
    const client = fs.readFileSync(path.join(process.cwd(), 'app/admin/leads/LeadsClient.tsx'), 'utf8')
    const offered = [...client.matchAll(/\{ value: '(\w+)', label: '[^']+' \}/g)]
      .map(match => match[1])
      .filter(value => value in JSON.parse(sortOrderKeys(source)))
    const mapped = Object.keys(JSON.parse(sortOrderKeys(source)))
    for (const key of offered) expect(mapped).toContain(key)
    // Including the one that made this work necessary: ranking by score across
    // the whole pipeline is why the score had to exist in SQL.
    expect(source).toContain("score_desc: { column: 'score'")
  })

  it('breaks ties on a stable column so a row cannot repeat across pages', () => {
    expect(source).toContain(".order('id', { ascending: true })")
  })

  it('sorts nulls last, as the client comparator did', () => {
    expect(source).toContain('nullsFirst: false')
  })

  it('counts the whole match, not the page', () => {
    expect(source).toContain("{ count: 'exact' }")
    expect(source).toContain('hasMore: total > rows.length')
  })

  it('leaves the summary unfiltered, so the cards can show what a filter hides', () => {
    const summary = source.slice(source.indexOf('export async function fetchLeadListSummary'))
    expect(summary).not.toContain('applyFilters')
  })
})

/** The SORT_ORDER map, as JSON, so a missing sort key fails rather than passes. */
function sortOrderKeys(source: string): string {
  const body = source.slice(source.indexOf('const SORT_ORDER'), source.indexOf('function selectLeads'))
  const keys = [...body.matchAll(/^\s{2}(\w+): \{/gm)].map(match => match[1])
  return JSON.stringify(Object.fromEntries(keys.map(key => [key, true])))
}
