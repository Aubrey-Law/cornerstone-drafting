import { firmDateKey } from '@/lib/firmDate'
import type { TaskRow } from '@/lib/tasks/types'
import { isDateKey } from './schedule'
import {
  isSlaAnchor,
  isSlaPhase,
  SLA_GATES,
  SLA_NUDGE_TIERS,
  SLA_VARIANTS,
  type PlanTask,
  type SlaGate,
  type SlaNudgeTier,
  type SlaVariant,
} from './types'

/**
 * Calendar days and timestamps, in both directions.
 *
 * A plan day is stored at 12:00Z, which lands on the same calendar day in
 * America/New_York on either side of a DST change. Reading it back through the
 * firm timezone is therefore lossless, which is what lets the plan keep
 * reasoning in days while `tasks` stores one due-date type for every surface.
 */
export function planDateKey(iso: string | null): string | null {
  return iso ? firmDateKey(iso) : null
}

export function planTimestamp(dateKey: string | null): string | null {
  return dateKey && isDateKey(dateKey) ? `${dateKey}T12:00:00.000Z` : null
}

function tier(value: unknown): SlaNudgeTier | null {
  return SLA_NUDGE_TIERS.includes(value as SlaNudgeTier) ? (value as SlaNudgeTier) : null
}

/** Read a `tasks` row through the plan's vocabulary. */
export function toPlanTask(row: TaskRow): PlanTask {
  return {
    ...row,
    name: row.title,
    start_date: row.plan_start_date,
    due_date: planDateKey(row.hard_due_at ?? row.due_at),
    nudge_date: planDateKey(row.nudge_at),
    escalation_date: planDateKey(row.escalation_at),
    phase: isSlaPhase(row.phase) ? row.phase : null,
    relative_to: isSlaAnchor(row.relative_to) ? row.relative_to : null,
    nudge_tier: tier(row.nudge_tier),
    escalation_tier: tier(row.escalation_tier),
    gate: SLA_GATES.includes(row.gate as SlaGate) ? (row.gate as SlaGate) : null,
    variant: SLA_VARIANTS.includes(row.variant as SlaVariant) ? (row.variant as SlaVariant) : null,
  }
}

export function toPlanTasks(rows: TaskRow[]): PlanTask[] {
  return rows.map(toPlanTask)
}

/**
 * The write side of the projection: turn the plan's calendar days back into the
 * timestamp columns `tasks` stores. `due_at` tracks `hard_due_at` on a plan task
 * that no stage has adopted, so the queue's effective-due-date sort — which
 * reads `due_at` first — puts plan work in the right place.
 */
export function planDateColumns(
  dates: {
    due_date?: string | null
    nudge_date?: string | null
    escalation_date?: string | null
  },
  options: { adopted?: boolean } = {},
): Record<string, string | null> {
  const columns: Record<string, string | null> = {}
  if (dates.due_date !== undefined) {
    columns.hard_due_at = planTimestamp(dates.due_date)
    // Once a stage has adopted the row, `due_at` is the stage's soft target and
    // `hard_due_at` alone carries the SLA — the same split every stage task has.
    if (!options.adopted) columns.due_at = planTimestamp(dates.due_date)
  }
  if (dates.nudge_date !== undefined) columns.nudge_at = planTimestamp(dates.nudge_date)
  if (dates.escalation_date !== undefined) {
    columns.escalation_at = planTimestamp(dates.escalation_date)
  }
  return columns
}
