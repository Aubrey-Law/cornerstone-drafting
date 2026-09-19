import { WEEKDAYS, type DayWindow, type Interval, type WeeklyHours } from './types'

/**
 * Pure slot computation — no I/O. All timezone math uses Intl so the firm's
 * weekly hours are interpreted in the firm timezone and returned as UTC
 * instants (DST-safe: each day's windows are expanded in the firm zone).
 */

export interface ComputeSlotsInput {
  weeklyHours: WeeklyHours
  /** IANA zone the weekly hours are expressed in, e.g. America/New_York. */
  timezone: string
  durationMinutes: number
  bufferMinutes: number
  minNoticeHours: number
  horizonDays: number
  /** Busy intervals (calendar + already-booked appointments), UTC ms. */
  busy: Interval[]
  /** Current instant (injectable for tests). */
  now: Date
  /** Requested range; intersected with [now + minNotice, now + horizon]. */
  rangeStart: Date
  rangeEnd: Date
  /** Slot grid step in minutes (slots start on this boundary within a window). */
  slotStepMinutes?: number
  /**
   * Per-date overrides ("YYYY-MM-DD" in the firm TZ). When a date has an
   * entry, its windows replace the weekly hours for that day; an empty
   * array closes the day entirely.
   */
  dateOverrides?: Record<string, DayWindow[]>
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

interface WallDate {
  year: number
  month: number
  day: number
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    dtfCache.set(timeZone, dtf)
  }
  return dtf
}

function wallPartsAt(utcMs: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  // Intl reports midnight as hour 24 in some environments with hour12:false.
  const rawHour = get('hour')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: get('minute'),
  }
}

/** Convert a wall-clock time in `timeZone` to a UTC instant (ms). */
export function zonedTimeToUtcMs(
  wall: WallDate & { hour: number; minute: number },
  timeZone: string,
): number {
  const desired = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  let ts = desired
  // Two iterations converge including across DST transitions.
  for (let i = 0; i < 2; i++) {
    const got = wallPartsAt(ts, timeZone)
    const gotTs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute)
    ts += desired - gotTs
  }
  return ts
}

function parseHHMM(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/** Weekday of a wall date (timezone-independent once the wall date is known). */
function weekdayOf(wall: WallDate) {
  return WEEKDAYS[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()]
}

function nextWallDate(wall: WallDate, timeZone: string): WallDate {
  // Anchor at noon in-zone and add 24h — immune to 23/25-hour DST days.
  const noon = zonedTimeToUtcMs({ ...wall, hour: 12, minute: 0 }, timeZone)
  const next = wallPartsAt(noon + DAY_MS, timeZone)
  return { year: next.year, month: next.month, day: next.day }
}

function overlaps(aStart: number, aEnd: number, b: Interval): boolean {
  return aStart < b.end && aEnd > b.start
}

/**
 * Compute bookable slot start times (UTC ISO strings, ascending).
 *
 * A slot is offered when:
 *  - it starts on the step grid inside a weekly-hours window (firm TZ),
 *  - the full duration fits inside the window,
 *  - it starts at/after now + minNoticeHours and within now + horizonDays,
 *  - it does not overlap any busy interval expanded by bufferMinutes.
 */
export function computeSlots(input: ComputeSlotsInput): string[] {
  const {
    weeklyHours,
    timezone,
    durationMinutes,
    bufferMinutes,
    minNoticeHours,
    horizonDays,
    busy,
    now,
    rangeStart,
    rangeEnd,
    slotStepMinutes = 30,
    dateOverrides,
  } = input

  if (durationMinutes <= 0) return []

  const earliest = Math.max(rangeStart.getTime(), now.getTime() + minNoticeHours * HOUR_MS)
  const latest = Math.min(rangeEnd.getTime(), now.getTime() + horizonDays * DAY_MS)
  if (earliest >= latest) return []

  const durationMs = durationMinutes * MINUTE_MS
  const stepMs = Math.max(slotStepMinutes, 5) * MINUTE_MS
  const paddedBusy: Interval[] = bufferMinutes > 0
    ? busy.map(b => ({ start: b.start - bufferMinutes * MINUTE_MS, end: b.end + bufferMinutes * MINUTE_MS }))
    : busy

  const slots: string[] = []
  let wall: WallDate = (() => {
    const p = wallPartsAt(earliest, timezone)
    return { year: p.year, month: p.month, day: p.day }
  })()

  // Iterate wall-calendar days until the day starts past the latest bound.
  for (let guard = 0; guard < 400; guard++) {
    const dayStartMs = zonedTimeToUtcMs({ ...wall, hour: 0, minute: 0 }, timezone)
    if (dayStartMs > latest) break

    const dateKey = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
    const windows = dateOverrides?.[dateKey] ?? weeklyHours[weekdayOf(wall)] ?? []
    for (const window of windows) {
      const start = parseHHMM(window.start)
      const end = parseHHMM(window.end)
      if (!start || !end) continue

      const windowStart = zonedTimeToUtcMs({ ...wall, ...start }, timezone)
      const windowEnd = zonedTimeToUtcMs({ ...wall, ...end }, timezone)
      if (windowEnd <= windowStart) continue

      for (let slotStart = windowStart; slotStart + durationMs <= windowEnd; slotStart += stepMs) {
        if (slotStart < earliest) continue
        if (slotStart > latest) break
        const slotEnd = slotStart + durationMs
        if (paddedBusy.some(b => overlaps(slotStart, slotEnd, b))) continue
        slots.push(new Date(slotStart).toISOString())
      }
    }

    wall = nextWallDate(wall, timezone)
  }

  return slots.sort()
}

/** True when `startIso` is one of the offered slots for the given inputs. */
export function isSlotAvailable(
  startIso: string,
  input: Omit<ComputeSlotsInput, 'rangeStart' | 'rangeEnd'>,
): boolean {
  const start = Date.parse(startIso)
  if (!Number.isFinite(start)) return false
  const slots = computeSlots({
    ...input,
    rangeStart: new Date(start - DAY_MS),
    rangeEnd: new Date(start + DAY_MS),
  })
  return slots.includes(new Date(start).toISOString())
}
