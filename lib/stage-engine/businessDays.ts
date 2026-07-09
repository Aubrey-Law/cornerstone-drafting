/**
 * Add business days in America/New_York (weekends only; holidays not modeled in TS).
 * Used for stage_tasks soft/hard due dates until we call SQL.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dow = result.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return result
}
