export const FIRM_TIMEZONE = 'America/New_York'

/** Today's date in the firm's timezone as YYYY-MM-DD. */
export function firmTodayKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
}

/** Any timestamp's calendar date in the firm's timezone as YYYY-MM-DD. */
export function firmDateKey(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
}
