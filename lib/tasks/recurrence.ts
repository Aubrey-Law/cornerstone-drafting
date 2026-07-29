import type { TaskRecurrence } from '@/lib/tasks/types'

/** Narrow unknown jsonb into a recurrence, or null when it is not one. */
export function parseRecurrence(value: unknown): TaskRecurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const every = Number(raw.every)
  const unit = raw.unit
  if (!Number.isFinite(every) || every <= 0) return null
  if (unit !== 'day' && unit !== 'week' && unit !== 'month') return null
  return {
    every: Math.floor(every),
    unit,
    until: typeof raw.until === 'string' ? raw.until : null,
    paused: raw.paused === true,
  }
}

export function advanceDate(from: Date, recurrence: TaskRecurrence): Date {
  const next = new Date(from)
  if (recurrence.unit === 'day') next.setDate(next.getDate() + recurrence.every)
  else if (recurrence.unit === 'week') next.setDate(next.getDate() + recurrence.every * 7)
  else next.setMonth(next.getMonth() + recurrence.every)
  return next
}

/**
 * When a recurring task is completed, the date its next occurrence is due.
 * Counts forward from the original due date so a cadence does not drift when a
 * task is closed late, but never lands in the past.
 *
 * Returns null when the cadence is paused or has run past its `until` date. An
 * `until` that names a stage (e.g. 'funded') is a condition the caller checks,
 * not a date, so it never stops the cadence here.
 */
export function nextOccurrence(
  recurrence: TaskRecurrence,
  previousDue: string | null,
  now: Date = new Date(),
): Date | null {
  if (recurrence.paused) return null

  let next = advanceDate(previousDue ? new Date(previousDue) : now, recurrence)
  if (Number.isNaN(next.getTime())) return null
  // A long-neglected cadence would otherwise re-create a task already overdue.
  let guard = 0
  while (next.getTime() <= now.getTime() && guard < 500) {
    next = advanceDate(next, recurrence)
    guard += 1
  }

  if (recurrence.until) {
    const until = new Date(recurrence.until)
    if (!Number.isNaN(until.getTime()) && next.getTime() > until.getTime()) return null
  }
  return next
}
