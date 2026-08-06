import { targetSigningDateInput } from '@/lib/matterDates'
import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * The three drafting dates hang off the target signing date. Nobody types them
 * for a normal matter, so they are derived — target signing minus 18 / 14 / 7
 * days — and an explicitly stored value always wins. Nothing is written back:
 * a stored derived date would drift the moment target signing moves.
 *
 * `drafts_due` has no column by design; it is derived or it is nothing.
 */

export type DraftingDateKey = 'drafts_due' | 'drafts_review' | 'revisions'

/** Days before target signing each drafting date lands on when not overridden. */
export const DRAFTING_DATE_OFFSETS: Record<DraftingDateKey, number> = {
  drafts_due: 18,
  drafts_review: 14,
  revisions: 7,
}

/** Which matter_details column, if any, stores an override for each key. */
export const DRAFTING_DATE_COLUMNS: Record<DraftingDateKey, keyof MatterDetailsRow | null> = {
  drafts_due: null,
  drafts_review: 'client_review_date',
  revisions: 'revisions_sent_date',
}

export interface DerivedDate {
  /** `YYYY-MM-DD`, or empty when there is neither a stored value nor an anchor. */
  value: string
  /** True when the value came from the target signing date rather than a column. */
  derived: boolean
}

function shiftDays(dateOnly: string, days: number): string {
  const parsed = new Date(`${dateOnly}T12:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  parsed.setUTCDate(parsed.getUTCDate() - days)
  return parsed.toISOString().slice(0, 10)
}

/** The stored override for a drafting date, as `YYYY-MM-DD`, or empty. */
export function storedDraftingDate(
  details: MatterDetailsRow | null | undefined,
  key: DraftingDateKey,
): string {
  const column = DRAFTING_DATE_COLUMNS[key]
  if (!column || !details) return ''
  const raw = details[column]
  return typeof raw === 'string' ? raw.slice(0, 10) : ''
}

export function resolveDraftingDate(
  details: MatterDetailsRow | null | undefined,
  key: DraftingDateKey,
): DerivedDate {
  const stored = storedDraftingDate(details, key)
  if (stored) return { value: stored, derived: false }

  const anchor = targetSigningDateInput(details?.scheduled_signing_date)
  if (!anchor) return { value: '', derived: false }
  return { value: shiftDays(anchor, DRAFTING_DATE_OFFSETS[key]), derived: true }
}
