import { zonedTimeToUtcMs } from '@/lib/appointments/availability'
import { WEEKDAYS, type Interval, type WeeklyHours, type DayWindow } from '@/lib/appointments/types'

export function dateInstant(date: string, timezone: string, time = '00:00'): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return zonedTimeToUtcMs({ year, month, day, hour, minute }, timezone)
}
export function nextDateKey(date: string, delta = 1): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
export function workingDayWindows(date: string, timezone: string, weeklyHours: WeeklyHours, overrides: Record<string, DayWindow[]>): Interval[] {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]
  return mergeIntervals((overrides[date] ?? weeklyHours[weekday]).map(window => ({ start: dateInstant(date, timezone, window.start), end: dateInstant(date, timezone, window.end) })))
}
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start).map(item => ({ ...item })).sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Interval[] = []
  for (const item of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end)
    else merged.push(item)
  }
  return merged
}
/** Free intervals inside working windows. Busy union is independent of UI filters. */
export function openGaps(windows: Interval[], busy: Interval[], from = -Infinity, bufferMinutes = 0): Interval[] {
  const padded = mergeIntervals(busy.map(item => ({ start: item.start - bufferMinutes * 60_000, end: item.end + bufferMinutes * 60_000 })))
  const gaps: Interval[] = []
  for (const window of mergeIntervals(windows)) {
    let cursor = Math.max(window.start, from)
    for (const item of padded) {
      if (item.end <= cursor || item.start >= window.end) continue
      if (item.start > cursor) gaps.push({ start: cursor, end: Math.min(item.start, window.end) })
      cursor = Math.max(cursor, item.end)
    }
    if (cursor < window.end) gaps.push({ start: cursor, end: window.end })
  }
  return gaps
}
export function intervalMinutes(intervals: Interval[]): number {
  return Math.round(mergeIntervals(intervals).reduce((total, item) => total + item.end - item.start, 0) / 60_000)
}
export function bookedMinutes(windows: Interval[], busy: Interval[]): number {
  return intervalMinutes(windows) - intervalMinutes(openGaps(windows, busy))
}
