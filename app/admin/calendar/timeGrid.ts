import type { CalendarAppointment, ExternalCalendarEvent } from './types'

/** Default time-grid window for day/week views (minutes from local midnight). */
export const GRID_START_MIN = 7 * 60
export const GRID_END_MIN = 19 * 60

/** Local day key, matching the calendar's own bucketing. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Minutes from local midnight for an ISO instant. */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * End of an event in minutes from its start day's midnight. An event running
 * past midnight clamps to end-of-day rather than wrapping to a small number.
 */
export function endMinutesOfDay(startIso: string, endIso: string): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  if (!sameDay) return 24 * 60
  return end.getHours() * 60 + end.getMinutes()
}

/**
 * Time-grid bounds for the days on screen. Starts from the standard business
 * window and widens (to the hour) around anything earlier or later, so an
 * calendar event at 6am or 9pm renders on the grid instead of being clipped
 * away — every Microsoft event in range has to be reachable in the app.
 */
export function timeGridBounds(
  days: Date[],
  byDay: Map<string, CalendarAppointment[]>,
  calendarByDay: Map<string, ExternalCalendarEvent[]>,
): { startMin: number; endMin: number } {
  let startMin = GRID_START_MIN
  let endMin = GRID_END_MIN
  const widen = (start: number, end: number) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return
    startMin = Math.min(startMin, start)
    endMin = Math.max(endMin, end)
  }
  for (const day of days) {
    const key = dayKey(day)
    for (const a of byDay.get(key) ?? []) {
      if (a.status === 'cancelled') continue
      widen(minutesOfDay(a.startTime), endMinutesOfDay(a.startTime, a.endTime))
    }
    for (const e of calendarByDay.get(key) ?? []) {
      if (e.isAllDay) continue
      widen(minutesOfDay(e.startIso), endMinutesOfDay(e.startIso, e.endIso))
    }
  }
  return {
    startMin: Math.max(0, Math.floor(startMin / 60) * 60),
    endMin: Math.min(24 * 60, Math.ceil(endMin / 60) * 60),
  }
}
