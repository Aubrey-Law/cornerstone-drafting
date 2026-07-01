import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Firm timezone — matches draft filename dates in the generate route. */
export const FIRM_TIMEZONE = 'America/New_York'

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
