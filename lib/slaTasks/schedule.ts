import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import {
  SLA_ASSIGNEES,
  SLA_NUDGE_TIERS,
  SLA_OPEN_STATUSES,
  SLA_PHASES,
  isSlaPhase,
  type MatterTaskRow,
  type SlaAssignee,
  type SlaNudgeTier,
  type SlaPhase,
  type SlaTemplateTask,
} from './types'

const DAY_MS = 86_400_000
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Every date in this module is a calendar day key (YYYY-MM-DD), never a
 * timestamp. Offsets are applied at UTC midnight so a matter that kicks off in
 * March still lands on the right day after the clocks change.
 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed)) return false
  // Rejects 2026-02-31 and friends, which Date.parse happily rolls over.
  return new Date(parsed).toISOString().slice(0, 10) === value
}

function dateKeyToMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`)
}

export function addDays(key: string, days: number): string {
  return new Date(dateKeyToMs(key) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateKeyToMs(to) - dateKeyToMs(from)) / DAY_MS)
}

function optionalOffset(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function optionalTier(value: unknown): SlaNudgeTier | null {
  return SLA_NUDGE_TIERS.includes(value as SlaNudgeTier) ? (value as SlaNudgeTier) : null
}

/**
 * Coerce one raw JSONB element into a task definition. Returns null for entries
 * missing the two fields that carry no sensible default (a name and a due
 * offset) rather than silently generating an undated task.
 */
export function parseTemplateTask(raw: unknown): SlaTemplateTask | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const dueOffset = optionalOffset(value.due_offset_days)
  if (!name || dueOffset === null) return null

  const nudgeOffset = optionalOffset(value.nudge_offset_days)
  const escalationOffset = optionalOffset(value.escalation_offset_days)

  return {
    phase: isSlaPhase(value.phase) ? value.phase : 'onboarding',
    name,
    due_offset_days: dueOffset,
    nudge_offset_days: nudgeOffset,
    // A tier with no date (or a date with no tier) would leave the nudge engine
    // unable to act, so the pair travels together or not at all.
    nudge_tier: nudgeOffset === null ? null : optionalTier(value.nudge_tier) ?? 'gentle',
    escalation_offset_days: escalationOffset,
    escalation_tier: escalationOffset === null ? null : optionalTier(value.escalation_tier) ?? 'firm',
    assignee: SLA_ASSIGNEES.includes(value.assignee as SlaAssignee)
      ? (value.assignee as SlaAssignee)
      : 'attorney',
    skill: typeof value.skill === 'string' && value.skill.trim() ? value.skill.trim() : null,
    auto: value.auto === true,
    conditional: value.conditional === true,
    pauses_clock: value.pauses_clock === true,
  }
}

export function parseTemplateTasks(raw: unknown): SlaTemplateTask[] {
  return Array.isArray(raw) ? raw.flatMap(item => parseTemplateTask(item) ?? []) : []
}

export interface MatterTaskInsert {
  matter_id: string
  template_id: string | null
  phase: SlaPhase
  name: string
  sort_order: number
  assignee: SlaAssignee
  skill: string | null
  conditional: boolean
  pauses_clock: boolean
  start_date: string
  due_date: string
  nudge_date: string | null
  nudge_tier: SlaNudgeTier | null
  escalation_date: string | null
  escalation_tier: SlaNudgeTier | null
}

/** Instantiate a template into dated rows. Pure — no I/O, no clock reads. */
export function buildMatterTaskInserts(
  tasks: SlaTemplateTask[],
  options: { matterId: string; templateId: string | null; startDate: string },
): MatterTaskInsert[] {
  const { matterId, templateId, startDate } = options
  return tasks.map((task, index) => ({
    matter_id: matterId,
    template_id: templateId,
    phase: task.phase,
    name: task.name,
    sort_order: index,
    assignee: task.assignee,
    skill: task.skill,
    conditional: task.conditional,
    pauses_clock: task.pauses_clock,
    start_date: startDate,
    due_date: addDays(startDate, task.due_offset_days),
    nudge_date: task.nudge_offset_days === null ? null : addDays(startDate, task.nudge_offset_days),
    nudge_tier: task.nudge_tier,
    escalation_date:
      task.escalation_offset_days === null ? null : addDays(startDate, task.escalation_offset_days),
    escalation_tier: task.escalation_tier,
  }))
}

// ── Clock pausing ───────────────────────────────────────────────────────────

/**
 * How many days a clock-pausing task slipped: the gap between its due date and
 * the day it actually landed. Never negative — finishing early does not pull
 * the rest of the plan forward, because the downstream dates are commitments,
 * not a critical path.
 */
export function delayDaysFor(dueDate: string, completedAt: string | Date): number {
  const iso = completedAt instanceof Date ? completedAt.toISOString() : completedAt
  const completedKey = firmDateKey(iso)
  if (!completedKey || !isDateKey(dueDate)) return 0
  return Math.max(0, daysBetween(dueDate, completedKey))
}

export interface ShiftedTaskDates {
  id: string
  due_date: string
  nudge_date: string | null
  escalation_date: string | null
}

/**
 * Push every still-open task after `fromSortOrder` out by `days`. Completed and
 * skipped tasks keep their historical dates.
 *
 * `inclusive` also moves the task at `fromSortOrder` itself, which is what a
 * resume needs: the paused task's own deadline slipped along with everything
 * behind it, so completing it later must not bill the same delay twice.
 */
export function shiftDownstreamTasks(
  tasks: Pick<MatterTaskRow, 'id' | 'sort_order' | 'status' | 'due_date' | 'nudge_date' | 'escalation_date'>[],
  fromSortOrder: number,
  days: number,
  options: { inclusive?: boolean } = {},
): ShiftedTaskDates[] {
  if (days <= 0) return []
  const matches = options.inclusive
    ? (order: number) => order >= fromSortOrder
    : (order: number) => order > fromSortOrder
  return tasks
    .filter(task => matches(task.sort_order) && SLA_OPEN_STATUSES.includes(task.status))
    .map(task => ({
      id: task.id,
      due_date: addDays(task.due_date, days),
      nudge_date: task.nudge_date ? addDays(task.nudge_date, days) : null,
      escalation_date: task.escalation_date ? addDays(task.escalation_date, days) : null,
    }))
}

// ── Progress ────────────────────────────────────────────────────────────────

export type SlaDueTone = 'done' | 'overdue' | 'soon' | 'on_track'

/** Colour band for a due date: red overdue, amber inside three days, else green. */
export function dueTone(
  task: Pick<MatterTaskRow, 'due_date' | 'status'>,
  today: string = firmTodayKey(),
): SlaDueTone {
  if (task.status === 'completed' || task.status === 'skipped') return 'done'
  const remaining = daysBetween(today, task.due_date)
  if (remaining < 0) return 'overdue'
  if (remaining <= 3) return 'soon'
  return 'on_track'
}

export interface SlaPhaseProgress {
  phase: SlaPhase
  total: number
  complete: number
  /** Includes skipped tasks — a phase with everything resolved is behind you. */
  resolved: number
}

export interface SlaProgress {
  phases: SlaPhaseProgress[]
  /** First phase with unresolved work, or the last phase once everything lands. */
  currentPhase: SlaPhase | null
  total: number
  complete: number
  overdue: number
  /**
   * Days left against the template's target, shifted by the delay the matter has
   * already absorbed. Negative once the target date is behind you.
   */
  daysRemaining: number | null
  targetDate: string | null
  totalPausedDays: number
}

export function summarizeSlaProgress(
  tasks: MatterTaskRow[],
  options: { targetDays?: number | null; today?: string } = {},
): SlaProgress {
  const today = options.today ?? firmTodayKey()
  const phases: SlaPhaseProgress[] = SLA_PHASES.map(phase => {
    const inPhase = tasks.filter(task => task.phase === phase)
    return {
      phase,
      total: inPhase.length,
      complete: inPhase.filter(task => task.status === 'completed').length,
      resolved: inPhase.filter(task => task.status === 'completed' || task.status === 'skipped').length,
    }
  })

  const withWork = phases.filter(phase => phase.total > 0)
  const currentPhase =
    withWork.find(phase => phase.resolved < phase.total)?.phase ??
    withWork[withWork.length - 1]?.phase ??
    null

  const totalPausedDays = tasks.reduce((sum, task) => sum + (task.total_paused_days || 0), 0)
  const startDate = tasks.length > 0 ? tasks[0].start_date : null
  const targetDays = typeof options.targetDays === 'number' ? options.targetDays : null
  const targetDate =
    startDate && targetDays !== null ? addDays(startDate, targetDays + totalPausedDays) : null

  return {
    phases,
    currentPhase,
    total: tasks.length,
    complete: tasks.filter(task => task.status === 'completed').length,
    overdue: tasks.filter(task => dueTone(task, today) === 'overdue').length,
    daysRemaining: targetDate ? daysBetween(today, targetDate) : null,
    targetDate,
    totalPausedDays,
  }
}
