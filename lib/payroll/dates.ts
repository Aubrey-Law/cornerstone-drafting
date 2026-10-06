/** Calendar arithmetic on ISO dates (YYYY-MM-DD), in UTC so no zone shifts a day. */

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isoDate(year: number, month: number, day: number): string {
  // Date.UTC rolls month 13 into January of the next year, as Excel's DATE does.
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

export function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  return Math.ceil(parts(iso).month / 3) as 1 | 2 | 3 | 4
}

/** Saturday or Sunday moves to Monday. Holidays are not modelled. */
export function nextBusinessDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  const weekday = date.getUTCDay()
  if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2)
  else if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
