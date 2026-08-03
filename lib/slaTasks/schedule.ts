import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import {
  SLA_ASSIGNEES,
  SLA_GATES,
  SLA_NUDGE_TIERS,
  SLA_OPEN_STATUSES,
  SLA_PHASES,
  SLA_VARIANTS,
  isSlaAnchor,
  isSlaPhase,
  type MatterTaskRow,
  type SlaAnchor,
  type SlaAnchorDates,
  type SlaClockAnchor,
  type SlaAssignee,
  type SlaGate,
  type SlaNudgeTier,
  type SlaPhase,
  type SlaTemplateTask,
  type SlaVariant,
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

function positiveOffset(value: unknown): number | null {
  const offset = optionalOffset(value)
  return offset !== null && offset > 0 ? offset : null
}

function optionalTier(value: unknown): SlaNudgeTier | null {
  return SLA_NUDGE_TIERS.includes(value as SlaNudgeTier) ? (value as SlaNudgeTier) : null
}

/**
 * Coerce one raw JSONB element into a task definition. Returns null only for an
 * entry with no name — a task with no due offset is legitimate on the soft
 * clock, where "lead schedules a discovery call" has no deadline the firm sets.
 */
export function parseTemplateTask(raw: unknown): SlaTemplateTask | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name) return null

  const dueOffset = optionalOffset(value.due_offset_days)
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
    relative_to: isSlaAnchor(value.relative_to) ? value.relative_to : null,
    pre_engagement: value.pre_engagement === true,
    gate: SLA_GATES.includes(value.gate as SlaGate) ? (value.gate as SlaGate) : null,
    extends_target_days: positiveOffset(value.extends_target_days),
    recurring_interval_days: positiveOffset(value.recurring_interval_days),
    variant: SLA_VARIANTS.includes(value.variant as SlaVariant) ? (value.variant as SlaVariant) : null,
    triggers_day_zero: value.triggers_day_zero === true,
  }
}

export function parseTemplateTasks(raw: unknown): SlaTemplateTask[] {
  return Array.isArray(raw) ? raw.flatMap(item => parseTemplateTask(item) ?? []) : []
}

// ── Anchors ─────────────────────────────────────────────────────────────────

/**
 * The date a task's offsets are measured from, or null when that anchor has not
 * happened yet. A null anchor produces an undated task rather than a guess: the
 * organizer is due the day before a PMPS nobody has scheduled.
 */
export function resolveAnchorDate(
  relativeTo: SlaAnchor | null,
  anchors: SlaAnchorDates,
  fallback: string | null,
): string | null {
  if (relativeTo === null) {
    const dayZero = anchors.engagement
    if (dayZero && isDateKey(dayZero)) return dayZero
    // No fallback on a template that knows about the pre-engagement stretch:
    // Day 0 is the engagement signature, and dating from anything else would
    // promise a client a date the firm has not committed to yet.
    return fallback
  }
  const anchor = anchors[relativeTo]
  return anchor && isDateKey(anchor) ? anchor : null
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
  due_date: string | null
  nudge_date: string | null
  nudge_tier: SlaNudgeTier | null
  escalation_date: string | null
  escalation_tier: SlaNudgeTier | null
  due_offset_days: number | null
  nudge_offset_days: number | null
  escalation_offset_days: number | null
  relative_to: SlaAnchor | null
  pre_engagement: boolean
  auto: boolean
  gate: SlaGate | null
  extends_target_days: number | null
  recurring_interval_days: number | null
  variant: SlaVariant | null
  triggers_day_zero: boolean
}

export interface BuildMatterTaskOptions {
  matterId: string
  templateId: string | null
  startDate: string
  /** Known anchor dates. Day 0 defaults to `startDate` when unsigned. */
  anchors?: SlaAnchorDates
  /**
   * Gates the matter has satisfied. A task gated on something absent here is
   * still generated, but stays undated and inert until the gate opens — dropping
   * it would lose the checklist entry entirely.
   */
  gatesMet?: SlaGate[]
  /** Alternative branches to include. Variant tasks are otherwise skipped. */
  variants?: SlaVariant[]
}

function offsetDate(anchor: string | null, offset: number | null): string | null {
  return anchor === null || offset === null ? null : addDays(anchor, offset)
}

/** Instantiate a template into dated rows. Pure — no I/O, no clock reads. */
export function buildMatterTaskInserts(
  tasks: SlaTemplateTask[],
  options: BuildMatterTaskOptions,
): MatterTaskInsert[] {
  const { matterId, templateId, startDate, anchors = {}, gatesMet = [], variants = [] } = options
  // A template carrying pre-engagement work models Day 0 as a real event, so an
  // unsigned matter leaves those tasks undated. A template without it (v1) is
  // only ever generated at hire, where the start date *is* Day 0.
  const dayZeroFallback = tasks.some(task => task.pre_engagement) ? null : startDate
  return tasks
    .filter(task => task.variant === null || variants.includes(task.variant))
    .map((task, index) => {
      // A task whose gate has not opened stays undated: it belongs on the
      // checklist, but the firm owes no date for work that may never start.
      const gateOpen = task.gate === null || gatesMet.includes(task.gate)
      const anchor = gateOpen ? resolveAnchorDate(task.relative_to, anchors, dayZeroFallback) : null
      return {
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
        due_date: offsetDate(anchor, task.due_offset_days),
        nudge_date: offsetDate(anchor, task.nudge_offset_days),
        nudge_tier: task.nudge_tier,
        escalation_date: offsetDate(anchor, task.escalation_offset_days),
        escalation_tier: task.escalation_tier,
        due_offset_days: task.due_offset_days,
        nudge_offset_days: task.nudge_offset_days,
        escalation_offset_days: task.escalation_offset_days,
        relative_to: task.relative_to,
        pre_engagement: task.pre_engagement,
        auto: task.auto,
        gate: task.gate,
        extends_target_days: task.extends_target_days,
        recurring_interval_days: task.recurring_interval_days,
        variant: task.variant,
        triggers_day_zero: task.triggers_day_zero,
      }
    })
}

export interface RescheduledTaskDates {
  id: string
  due_date: string | null
  nudge_date: string | null
  escalation_date: string | null
}

/**
 * Date every still-open task hanging off `anchor` once that anchor lands — the
 * client books the PMPS, or signs and starts the firm clock. Completed and
 * skipped tasks keep their historical dates.
 *
 * Recomputes from the stored offsets rather than shifting existing dates, so
 * re-running after the anchor moves again is idempotent.
 */
export function rescheduleForAnchor(
  tasks: Pick<
    MatterTaskRow,
    | 'id'
    | 'status'
    | 'relative_to'
    | 'due_offset_days'
    | 'nudge_offset_days'
    | 'escalation_offset_days'
    | 'due_date'
    | 'nudge_date'
    | 'escalation_date'
  >[],
  anchor: SlaClockAnchor,
  anchorDate: string,
): RescheduledTaskDates[] {
  if (!isDateKey(anchorDate)) return []
  // Day-0 tasks are stored with a null `relative_to`; the other two name theirs.
  const relativeTo = anchor === 'engagement' ? null : anchor
  return tasks.flatMap(task => {
    if (task.relative_to !== relativeTo || !SLA_OPEN_STATUSES.includes(task.status)) return []
    const next: RescheduledTaskDates = {
      id: task.id,
      due_date: offsetDate(anchorDate, task.due_offset_days),
      nudge_date: offsetDate(anchorDate, task.nudge_offset_days),
      escalation_date: offsetDate(anchorDate, task.escalation_offset_days),
    }
    const unchanged =
      next.due_date === task.due_date &&
      next.nudge_date === task.nudge_date &&
      next.escalation_date === task.escalation_date
    return unchanged ? [] : [next]
  })
}

// ── Clock pausing ───────────────────────────────────────────────────────────

/**
 * How many days a clock-pausing task slipped: the gap between its due date and
 * the day it actually landed. Never negative — finishing early does not pull
 * the rest of the plan forward, because the downstream dates are commitments,
 * not a critical path. An undated task cannot slip.
 */
export function delayDaysFor(dueDate: string | null, completedAt: string | Date): number {
  const iso = completedAt instanceof Date ? completedAt.toISOString() : completedAt
  const completedKey = firmDateKey(iso)
  if (!completedKey || !dueDate || !isDateKey(dueDate)) return 0
  return Math.max(0, daysBetween(dueDate, completedKey))
}

export interface ShiftedTaskDates {
  id: string
  due_date: string | null
  nudge_date: string | null
  escalation_date: string | null
}

/**
 * Push every still-open task after `fromSortOrder` out by `days`. Completed and
 * skipped tasks keep their historical dates, and undated tasks stay undated —
 * their anchor has not landed, so there is nothing to push.
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
    .filter(
      task =>
        matches(task.sort_order) &&
        SLA_OPEN_STATUSES.includes(task.status) &&
        task.due_date !== null,
    )
    .map(task => ({
      id: task.id,
      due_date: task.due_date ? addDays(task.due_date, days) : null,
      nudge_date: task.nudge_date ? addDays(task.nudge_date, days) : null,
      escalation_date: task.escalation_date ? addDays(task.escalation_date, days) : null,
    }))
}

// ── Progress ────────────────────────────────────────────────────────────────

export type SlaDueTone = 'done' | 'overdue' | 'soon' | 'on_track' | 'unscheduled'

/**
 * Colour band for a due date: red overdue, amber inside three days, else green.
 * A task whose anchor has not landed is unscheduled, not on track — the firm has
 * made no commitment about it yet.
 */
export function dueTone(
  task: Pick<MatterTaskRow, 'due_date' | 'status'>,
  today: string = firmTodayKey(),
): SlaDueTone {
  if (task.status === 'completed' || task.status === 'skipped') return 'done'
  if (!task.due_date) return 'unscheduled'
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
  /** Open tasks still waiting on an anchor date. */
  unscheduled: number
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
  options: { targetDays?: number | null; today?: string; startDate?: string | null } = {},
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
  // Round 2 revisions and friends move the finish line for the whole matter.
  const extensionDays = tasks
    .filter(task => task.status !== 'skipped')
    .reduce((sum, task) => sum + (task.extends_target_days || 0), 0)
  // Day 0 for the firm clock. Pre-engagement tasks share the generation start
  // date, so the first Day-0-relative task is the one that dates the target.
  const startDate =
    options.startDate ??
    tasks.find(task => task.relative_to === null && !task.pre_engagement)?.start_date ??
    (tasks.length > 0 ? tasks[0].start_date : null)
  const targetDays = typeof options.targetDays === 'number' ? options.targetDays : null
  const targetDate =
    startDate && targetDays !== null
      ? addDays(startDate, targetDays + totalPausedDays + extensionDays)
      : null

  return {
    phases,
    currentPhase,
    total: tasks.length,
    complete: tasks.filter(task => task.status === 'completed').length,
    overdue: tasks.filter(task => dueTone(task, today) === 'overdue').length,
    unscheduled: tasks.filter(task => dueTone(task, today) === 'unscheduled').length,
    daysRemaining: targetDate ? daysBetween(today, targetDate) : null,
    targetDate,
    totalPausedDays,
  }
}
