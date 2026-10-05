import { toDateInputValue } from '@/lib/dob'

/**
 * The signing date as the design sheet stores it: `YYYY-MM-DD`, or null when the
 * text is not a real calendar date. `toDateInputValue` already reads the shapes
 * notes arrive in (ISO, MM/DD/YYYY, "October 15, 2026"); this also refuses a
 * date that only looks valid, such as 2026-02-31, which `Date.UTC` would roll
 * over into March.
 */
export function normalizeSigningDate(value: string | null | undefined): string | null {
  const iso = toDateInputValue(value)
  if (!iso) return null
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? iso : null
}

/**
 * The month and year columns the documents print, derived from the signing
 * date. They are stored separately so a document can say "this ___ day of
 * October, 2026"; whatever sets `signing_date` has to set these too, or the
 * date and the words beside it disagree.
 */
export function signingDateParts(isoDate: string | null): { signing_month: string | null; signing_year: string | null } {
  if (!isoDate) return { signing_month: null, signing_year: null }
  // Noon, not midnight: a local-time midnight can fall on the previous day.
  const date = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return { signing_month: null, signing_year: null }
  return {
    signing_month: date.toLocaleString('en-US', { month: 'long' }),
    signing_year: String(date.getFullYear()),
  }
}
