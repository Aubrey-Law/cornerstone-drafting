/**
 * Quick-capture parsing for the rail's task input.
 *
 * Turns `Call the Hendersons Fri 2pm !high` into a title, a due date and a
 * priority, and reports the `@record` / `/template` tokens so the composer can
 * open its pickers. Deliberately small: anything it cannot read stays in the
 * title rather than being guessed at.
 */

import { FIRM_TIMEZONE } from '@/lib/firmDate'
import type { TaskPriority } from '@/lib/tasks/types'

export interface ParsedCapture {
  title: string
  dueAt: Date | null
  /** The text the date was read from, so the composer can show it as a chip. */
  dueText: string | null
  priority: TaskPriority | null
  /** Text after a trailing `@` — the record picker's live query. */
  recordQuery: string | null
  /** Text after a trailing `/` — the template picker's live query. */
  templateQuery: string | null
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
}

/** Offset in minutes between UTC and the firm's timezone at `date`. */
function firmOffsetMinutes(date: Date): number {
  const local = new Date(date.toLocaleString('en-US', { timeZone: FIRM_TIMEZONE }))
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((local.getTime() - utc.getTime()) / 60_000)
}

/**
 * Build an instant from a firm-local wall-clock date and time. Two passes: the
 * first offset guess can be wrong across a DST boundary, the second corrects it.
 */
function firmWallClock(year: number, month: number, day: number, hours: number, minutes: number): Date {
  const naive = Date.UTC(year, month, day, hours, minutes)
  let result = new Date(naive - firmOffsetMinutes(new Date(naive)) * 60_000)
  result = new Date(naive - firmOffsetMinutes(result) * 60_000)
  return result
}

/** Today's firm-local calendar parts. */
function firmParts(now: Date): { year: number; month: number; day: number } {
  const [year, month, day] = now
    .toLocaleDateString('en-CA', { timeZone: FIRM_TIMEZONE })
    .split('-')
    .map(Number)
  return { year, month: month - 1, day }
}

function firmWeekday(now: Date): number {
  const label = now.toLocaleDateString('en-US', { timeZone: FIRM_TIMEZONE, weekday: 'short' }).toLowerCase()
  return WEEKDAYS[label] ?? now.getDay()
}

interface TimeMatch {
  hours: number
  minutes: number
  source: string
}

/** `2pm`, `2:30pm`, `14:30`, `at 9`. */
function readTime(text: string): TimeMatch | null {
  const meridiem = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text)
  if (meridiem) {
    let hours = Number(meridiem[1]) % 12
    if (meridiem[3].toLowerCase() === 'pm') hours += 12
    return { hours, minutes: Number(meridiem[2] ?? 0), source: meridiem[0] }
  }
  const military = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text)
  if (military) {
    return { hours: Number(military[1]), minutes: Number(military[2]), source: military[0] }
  }
  return null
}

interface DayMatch {
  date: { year: number; month: number; day: number }
  source: string
}

function readDay(text: string, now: Date): DayMatch | null {
  const today = firmParts(now)

  const relative = /\b(today|tonight|tomorrow|tmrw)\b/i.exec(text)
  if (relative) {
    const shift = /^(tomorrow|tmrw)$/i.test(relative[1]) ? 1 : 0
    const d = new Date(Date.UTC(today.year, today.month, today.day + shift))
    return {
      date: { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() },
      source: relative[0],
    }
  }

  const inDays = /\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/i.exec(text)
  if (inDays) {
    const amount = Number(inDays[1]) * (/^week/i.test(inDays[2]) ? 7 : 1)
    const d = new Date(Date.UTC(today.year, today.month, today.day + amount))
    return {
      date: { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() },
      source: inDays[0],
    }
  }

  const named = /\b(next\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/i.exec(text)
  if (named) {
    const target = WEEKDAYS[named[2].toLowerCase()]
    const current = firmWeekday(now)
    // Bare weekday means the next one; "next Fri" always skips a week.
    let delta = (target - current + 7) % 7
    if (delta === 0) delta = 7
    if (named[1]) delta += 7
    const d = new Date(Date.UTC(today.year, today.month, today.day + delta))
    return {
      date: { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() },
      source: named[0],
    }
  }

  const monthDay = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})\b/i.exec(text)
  if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()]
    const day = Number(monthDay[2])
    // A month already past this year means next year.
    const year = month < today.month || (month === today.month && day < today.day)
      ? today.year + 1
      : today.year
    return { date: { year, month, day }, source: monthDay[0] }
  }

  return null
}

const DEFAULT_DUE_HOUR = 17

export function parseCapture(input: string, now: Date = new Date()): ParsedCapture {
  let text = input

  const recordQuery = /(?:^|\s)@([^\s@/]*)$/.exec(text)?.[1] ?? null
  const templateQuery = /(?:^|\s)\/([^\s@/]*)$/.exec(text)?.[1] ?? null

  let priority: TaskPriority | null = null
  const priorityMatch = /(?:^|\s)!(high|normal|low)\b/i.exec(text)
  if (priorityMatch) {
    priority = priorityMatch[1].toLowerCase() as TaskPriority
    text = text.replace(priorityMatch[0], ' ')
  }

  const day = readDay(text, now)
  const time = day ? readTime(text) : null

  let dueAt: Date | null = null
  let dueText: string | null = null
  if (day) {
    dueAt = firmWallClock(
      day.date.year,
      day.date.month,
      day.date.day,
      time?.hours ?? DEFAULT_DUE_HOUR,
      time?.minutes ?? 0,
    )
    dueText = time ? `${day.source} ${time.source}` : day.source
    text = text.replace(day.source, ' ')
    if (time) text = text.replace(time.source, ' ')
  }

  const title = text
    .replace(/(?:^|\s)[@/][^\s]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { title, dueAt, dueText, priority, recordQuery, templateQuery }
}
