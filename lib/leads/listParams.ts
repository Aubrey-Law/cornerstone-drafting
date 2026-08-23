import { PRACTICE_AREA_OPTIONS, practiceAreaMatterCode } from '@/lib/practiceArea'
import type { LeadProgressFilter, LeadSortKey } from '@/lib/adminTables/leadTable'

/**
 * The shape of a leads-list request, and the pure translation from what the
 * reader typed into what the database can filter on.
 *
 * Split out of `lib/queries/leadList.ts` because the list is now driven from
 * the URL: the client component needs the page size and the parameter shape,
 * and that module is server-only.
 */

export const LEAD_PAGE_SIZE = 50

/** Hard ceiling on one request, so a hand-edited `show` cannot ask for everything. */
export const MAX_LEAD_PAGE_SIZE = 500

export type LeadStatusFilter = 'open' | 'lost' | 'declined' | 'all'
export type LeadCardFilterKey = 'attention' | 'agreements'

export interface LeadListParams {
  status: LeadStatusFilter
  card: LeadCardFilterKey | null
  search: string
  practice: string
  progress: LeadProgressFilter
  sort: LeadSortKey
  /** Rows to return from the top of the ordering — "load more" raises it. */
  show: number
}

export interface LeadListSummary {
  /** Tab counts, over the whole pipeline rather than the loaded page. */
  open: number
  lost: number
  declined: number
  all: number
  /** Insight cards, counted over open leads only, as the cards always have. */
  attention: number
  agreements: number
  awaitingIntake: number
  quotedPipeline: number
}

export const EMPTY_LEAD_LIST_PARAMS: LeadListParams = {
  status: 'open',
  card: null,
  search: '',
  practice: 'all',
  progress: 'all',
  sort: 'newest',
  show: LEAD_PAGE_SIZE,
}

export const EMPTY_LEAD_LIST_SUMMARY: LeadListSummary = {
  open: 0, lost: 0, declined: 0, all: 0,
  attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
}

export function clampShow(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return LEAD_PAGE_SIZE
  const rounded = Math.floor(value as number)
  return Math.max(LEAD_PAGE_SIZE, Math.min(MAX_LEAD_PAGE_SIZE, rounded))
}

function escapeForOr(value: string): string {
  // A comma ends a PostgREST `or()` term and a parenthesis ends the group, so a
  // search containing either would be read as more filters rather than as text.
  return value.replace(/[,()]/g, ' ')
}

/**
 * The columns a free-text search matches, as one PostgREST `or` group.
 *
 * The browser used to match two derived values as well — the practice area's
 * label, and the provisional lead number the table shows. Neither is a column,
 * so rather than restating those vocabularies in SQL the term is translated
 * here: a search naming a practice area also matches that area's code, and a
 * lead-number-shaped search is split into the parts a column does hold.
 */
export function buildLeadSearchFilter(term: string): string | null {
  const trimmed = term.trim()
  if (!trimmed) return null

  const terms = new Set<string>([trimmed])
  // "2026-EP-Smith" is a year, a practice code and a last name; the last name
  // is the part a column holds, and the year is not worth matching as text.
  // Only a lead-number-shaped term is split — splitting on every hyphen would
  // turn a phone number into a search for every lead in the 617 area code.
  if (/^\d{4}-[A-Za-z-]{2,6}-\S+/.test(trimmed)) {
    for (const part of trimmed.split('-').map(value => value.trim()).filter(Boolean)) {
      if (!/^\d{4}$/.test(part)) terms.add(part)
    }
  }

  const codes = new Set<string>()
  for (const option of PRACTICE_AREA_OPTIONS) {
    const haystack = `${option.label} ${option.value} ${practiceAreaMatterCode(option.value)}`.toLowerCase()
    for (const value of terms) {
      if (value.length >= 2 && haystack.includes(value.toLowerCase())) codes.add(option.value)
    }
  }

  const clauses: string[] = []
  for (const value of terms) {
    const pattern = `*${escapeForOr(value)}*`
    clauses.push(
      `full_name.ilike.${pattern}`,
      `first_name.ilike.${pattern}`,
      `last_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
      `practice_area.ilike.${pattern}`,
    )
  }
  for (const code of codes) clauses.push(`practice_area.eq.${escapeForOr(code)}`)
  return clauses.join(',')
}
