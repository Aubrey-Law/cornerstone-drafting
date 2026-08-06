import { firmTodayKey } from '@/lib/firmDate'

/**
 * `next_action_date` is the attorney's own answer to "when does this matter
 * need me again". It drives the matter header pill and the weekly board, and
 * unlike the SLA clock it is set by hand — a matter can be perfectly on-SLA
 * and still need a call on Thursday.
 */

export interface NextActionPresentation {
  /** `YYYY-MM-DD`. */
  date: string
  label: string
  tone: 'overdue' | 'today' | 'soon' | 'later'
}

const DAY_MS = 86_400_000

/** Whole days from the firm's today to a `YYYY-MM-DD` date. Negative is past. */
export function daysUntil(dateKey: string, today = firmTodayKey()): number | null {
  const target = Date.parse(`${dateKey.slice(0, 10)}T12:00:00Z`)
  const from = Date.parse(`${today}T12:00:00Z`)
  if (Number.isNaN(target) || Number.isNaN(from)) return null
  return Math.round((target - from) / DAY_MS)
}

export function presentNextAction(
  nextActionDate: string | null | undefined,
  today = firmTodayKey(),
): NextActionPresentation | null {
  if (!nextActionDate) return null
  const date = nextActionDate.slice(0, 10)
  const days = daysUntil(date, today)
  if (days === null) return null

  if (days < 0) {
    return { date, label: `Next action ${-days}d overdue`, tone: 'overdue' }
  }
  if (days === 0) return { date, label: 'Next action today', tone: 'today' }
  if (days === 1) return { date, label: 'Next action tomorrow', tone: 'soon' }
  if (days <= 7) return { date, label: `Next action in ${days}d`, tone: 'soon' }
  return { date, label: `Next action in ${days}d`, tone: 'later' }
}

/** Within the coming week, or already past — what the weekly board shows. */
export function isOnWeeklyBoard(
  nextActionDate: string | null | undefined,
  today = firmTodayKey(),
): boolean {
  if (!nextActionDate) return false
  const days = daysUntil(nextActionDate.slice(0, 10), today)
  return days !== null && days <= 7
}
