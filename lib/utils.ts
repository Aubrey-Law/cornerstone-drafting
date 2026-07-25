import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Firm timezone — matches draft filename dates in the generate route. */
export const FIRM_TIMEZONE = 'America/New_York'

const DAY_MS = 86_400_000

/**
 * Return the calendar-day ordinal for an instant in the requested timezone.
 * Using local date parts avoids elapsed-hour errors across DST boundaries.
 */
export function calendarDayOrdinal(
  value: string | number | Date,
  timeZone: string = FIRM_TIMEZONE,
): number | null {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value)
  const year = valueFor('year')
  const month = valueFor('month')
  const day = valueFor('day')
  if (![year, month, day].every(Number.isFinite)) return null

  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
}

/** Whole calendar days from `earlier` to `later` in the configured timezone. */
export function calendarDayDifference(
  later: string | number | Date,
  earlier: string | number | Date,
  timeZone: string = FIRM_TIMEZONE,
): number | null {
  const laterDay = calendarDayOrdinal(later, timeZone)
  const earlierDay = calendarDayOrdinal(earlier, timeZone)
  return laterDay === null || earlierDay === null ? null : laterDay - earlierDay
}

/**
 * Format a date string consistently to avoid hydration mismatches
 * Uses a fixed locale and timezone to ensure server/client consistency
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Date and time for document generation timestamps (Eastern). */
export function formatDateTime(dateString: string, timeZone: string = FIRM_TIMEZONE): string {
  const date = new Date(dateString)
  const datePart = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  })
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
  return `${datePart} · ${timePart}`
}

/** Show time for timestamps without inventing midnight for date-only fields. */
export function formatDateDetail(dateString: string, timeZone: string = FIRM_TIMEZONE): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateString.trim())
    ? formatDate(dateString)
    : formatDateTime(dateString, timeZone)
}
