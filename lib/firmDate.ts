export const FIRM_TIMEZONE = 'America/New_York'

/** Today's date in the firm's timezone as YYYY-MM-DD. */
export function firmTodayKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
}

/** Any timestamp's calendar date in the firm's timezone as YYYY-MM-DD. */
export function firmDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  // A date-only value already identifies a calendar day; do not shift it through UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Number.isNaN(Date.parse(iso)) ? null : iso
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
}

/**
 * Whether a date input's value is finished being typed, rather than a year the
 * user is still partway through.
 *
 * `<input type="date">` reports "" until all three segments hold something, and
 * a complete value the instant they do — including while the year is still
 * arriving. Typing 2026 passes through 0002, 0020 and 0202, each of them a
 * valid date the browser hands to `onChange`. A field that saves on change
 * therefore saves the first of those and closes, which is why entering a date
 * in the opportunity rail took one segment per attempt, and how a lead ended up
 * carrying a 1969 milestone.
 *
 * A four-digit year is the signal: no real entry has a year below 1000, and
 * every prefix of a real one does.
 */
export function isSettledDateEntry(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  return Number(match[1]) >= 1000
}
