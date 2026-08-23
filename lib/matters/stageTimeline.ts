import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'

/**
 * Turning recorded stage transitions into readable intervals.
 *
 * Deliberately free of `server-only` and of any Supabase import: the card that
 * renders this is a client component and needs the types, while the reader that
 * fetches the rows is server-side. Keeping the shape and the arithmetic here
 * lets both share one definition.
 */

export interface MatterStageHistoryRow {
  id: number
  from_stage: string | null
  to_stage: string
  entered_at: string
  created_at: string
  actor_id: string | null
}

export interface MatterStageHistoryEntry {
  id: number
  stage: string
  /** Null on the earliest recorded row, which has nothing before it. */
  fromStage: string | null
  enteredAt: string
  /** When the matter left this stage; null while it is still the current one. */
  exitedAt: string | null
  /** Calendar days in this stage, counted to the exit or to today. */
  days: number
  isCurrent: boolean
  /**
   * The earliest recorded row. It is a starting point rather than an observed
   * move — either the matter's creation, or the row the migration seeded for a
   * matter that predates the table — so the UI must not read it as "moved from
   * nothing into this stage".
   */
  isStart: boolean
  actorId: string | null
  actorName: string | null
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Days between two instants, floored at zero so a clock skew cannot read negative. */
function daysBetween(laterIso: string | null, earlierIso: string): number {
  const later = laterIso ?? new Date().toISOString()
  return Math.max(0, calendarDayDifference(later, earlierIso, FIRM_TIMEZONE) ?? 0)
}

/**
 * Turns transition rows into intervals. Sorted by the business entry date, with
 * the row id breaking ties — two stages entered on the same pinned date would
 * otherwise order arbitrarily.
 */
export function buildStageTimeline(
  rows: MatterStageHistoryRow[],
  actorNames: Map<string, string> = new Map(),
): MatterStageHistoryEntry[] {
  const ordered = [...rows].sort((a, b) => {
    const delta = timestamp(a.entered_at) - timestamp(b.entered_at)
    return delta !== 0 ? delta : a.id - b.id
  })

  return ordered.map((row, index) => {
    const next = ordered[index + 1] ?? null
    const exitedAt = next ? next.entered_at : null
    return {
      id: row.id,
      stage: row.to_stage,
      fromStage: row.from_stage,
      enteredAt: row.entered_at,
      exitedAt,
      days: daysBetween(exitedAt, row.entered_at),
      isCurrent: next === null,
      isStart: index === 0,
      actorId: row.actor_id,
      actorName: row.actor_id ? actorNames.get(row.actor_id) ?? null : null,
    }
  })
}
