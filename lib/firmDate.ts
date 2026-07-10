const FIRM_TIMEZONE = 'America/New_York'

/** Today's date in the firm's timezone as YYYY-MM-DD. */
export function firmTodayKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
}
