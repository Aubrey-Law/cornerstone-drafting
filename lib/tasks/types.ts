import { FIRM_TIMEZONE, firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type { TaskTemplateItem } from '@/lib/tasks/templateItems'

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'archived'] as const
export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const
/**
 * `'prompt'` is a task a prompt run created — the database has allowed it
 * since 20261029000000_prompt_task_source.sql, and this union did not, so
 * every such task rendered with an empty source pill and could not be
 * filtered for. `'fiduciary'` is the same kind of value, added by
 * 20261105000000_fiduciary_task_source.sql for the findings of the
 * deterministic fiduciary matrix, and added here in the same commit for
 * exactly that reason. The workbench writes both kinds of row and never reads
 * them; this app is the only place they are seen, so a value the database
 * allows and this union omits is a task nobody can see the origin of.
 */
export const TASK_SOURCES = ['manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary', 'identity'] as const
export const TASK_TYPES = ['single', 'checklist'] as const

/**
 * Who owes the work. Distinct from `assignee_id`, which names a person at the
 * firm: a plan task owned by the client or by an automation has no assignee and
 * must stay out of the firm's working queue, while still counting on the plan.
 */
export const TASK_OWNERS = ['firm', 'client', 'automation'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskOwner = (typeof TASK_OWNERS)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskSource = (typeof TASK_SOURCES)[number]
export type TaskType = (typeof TASK_TYPES)[number]

export interface ChecklistItem {
  text: string
  done: boolean
}

export interface TaskRecurrence {
  every: number
  unit: 'day' | 'week' | 'month'
  /** A stage key ('funded'), an ISO date, or absent for open-ended. */
  until?: string | null
  paused?: boolean
}

/** One row of `public.tasks`, plus the display fields the list surfaces join in. */
export interface TaskRow {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  source: TaskSource
  task_type: TaskType
  checklist: ChecklistItem[]
  matter_id: string | null
  lead_id: string | null
  stage_key: string | null
  stage_entered_at: string | null
  batch_tag: string | null
  soft_due_at: string | null
  hard_due_at: string | null
  due_at: string | null
  assignee_id: string | null
  estimate_minutes: number | null
  remind_at: string | null
  recurrence: TaskRecurrence | null
  template_id: string | null
  document_id: string | null
  completed_at: string | null
  completed_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string

  // ── Plan fields (source = 'sla', and `phase` on stage tasks) ──────────────
  // See supabase/migrations/20261003000000_tasks_absorb_sla_plan.sql. Every one
  // of these is null/default on an ad-hoc task; they carry the dated SLA spine
  // that used to live in its own `matter_tasks` table.
  /** Pipeline stage, not the engine key `stage_key` holds. */
  phase: string | null
  owner: TaskOwner
  plan_template_id: string | null
  sort_order: number
  skill: string | null
  /** The attorney's running notes, as opposed to the template's `description`. */
  notes: string | null
  plan_start_date: string | null
  /** Null means Day 0 — the engagement signature. */
  relative_to: string | null
  due_offset_days: number | null
  nudge_offset_days: number | null
  escalation_offset_days: number | null
  nudge_at: string | null
  nudge_tier: string | null
  escalation_at: string | null
  escalation_tier: string | null
  nudge_sent_at: string | null
  escalation_sent_at: string | null
  pauses_clock: boolean
  paused_at: string | null
  total_paused_days: number
  pre_engagement: boolean
  auto: boolean
  conditional: boolean
  gate: string | null
  variant: string | null
  extends_target_days: number | null
  recurring_interval_days: number | null
  triggers_day_zero: boolean
  /** Set alongside status 'archived' when the task is skipped as N/A. */
  skipped_at: string | null
  /**
   * Why an automatic sweep archived this task — its matter closed, or its lead
   * went lost or declined. Null on a task the user skipped by hand, which is
   * what keeps the reopen path from un-skipping it. See lib/tasks/closeout.ts.
   */
  closeout_reason: string | null

  /** Joined for display — the matter/lead this task hangs off. */
  record_name?: string | null
  assignee_name?: string | null
}

export interface TaskTemplateRow {
  id: string
  name: string
  description: string | null
  items: TaskTemplateItem[]
  created_at: string
}

export interface TaskCounts {
  overdue: number
  today: number
  open: number
  mine: number
  team: number
  unassigned: number
}

/** Open/overdue counts for one record — the Tasks tab trigger badge. */
export interface RecordTaskCounts {
  open: number
  overdue: number
}

export const EMPTY_RECORD_TASK_COUNTS: RecordTaskCounts = { open: 0, overdue: 0 }

export const EMPTY_TASK_COUNTS: TaskCounts = {
  overdue: 0,
  today: 0,
  open: 0,
  mine: 0,
  team: 0,
  unassigned: 0,
}

/**
 * A task's working due date. Manual tasks carry `due_at`; stage-engine tasks
 * work off their soft date and keep `hard_due_at` as the SLA badge. Every
 * grouping and sort in the app runs off this one value.
 */
export function effectiveDueAt(task: Pick<TaskRow, 'due_at' | 'soft_due_at' | 'hard_due_at'>): string | null {
  return task.due_at ?? task.soft_due_at ?? task.hard_due_at ?? null
}

export function isTaskOpen(task: Pick<TaskRow, 'status'>): boolean {
  return task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked'
}

/**
 * Archived because it did not apply, rather than abandoned. Only the first
 * counts as plan progress, and `skipped_at` is the only thing that tells them
 * apart — the status is 'archived' either way.
 */
export function isTaskSkipped(task: Pick<TaskRow, 'status' | 'skipped_at'>): boolean {
  return task.status === 'archived' && !!task.skipped_at
}

/** Done or deliberately skipped — either way, the phase has moved past it. */
export function isTaskResolved(task: Pick<TaskRow, 'status' | 'skipped_at'>): boolean {
  return task.status === 'done' || isTaskSkipped(task)
}

export type TaskDueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done'

/** The fields grouping and overdue checks actually read. */
export type TaskDueFields = Pick<TaskRow, 'status' | 'due_at' | 'soft_due_at' | 'hard_due_at'>

/**
 * Which due-date group a task lands in, evaluated in the firm's timezone so a
 * task due "today" does not flip to overdue for an attorney travelling west.
 */
export function taskDueGroup(task: TaskDueFields, now: Date = new Date()): TaskDueGroup {
  if (!isTaskOpen(task)) return 'done'
  const due = effectiveDueAt(task)
  if (!due) return 'none'

  const dueKey = firmDateKey(due)
  const todayKey = firmTodayKey(now)
  if (!dueKey) return 'none'
  if (dueKey < todayKey) return 'overdue'
  if (dueKey === todayKey) return 'today'

  // "This week" is the next 6 days, so Friday's tasks stay visible on Monday.
  const weekEnd = new Date(now.getTime() + 6 * 86_400_000)
  return dueKey <= firmTodayKey(weekEnd) ? 'week' : 'later'
}

export function isTaskOverdue(task: TaskDueFields, now: Date = new Date()): boolean {
  return taskDueGroup(task, now) === 'overdue'
}

/**
 * Reduce a record's open tasks to its badge counts. Lives here, not next to the
 * hook that consumes it: the server pages seed the badge, and a `'use client'`
 * module cannot be called during a server render.
 */
export function recordTaskCounts(tasks: TaskDueFields[], now: Date = new Date()): RecordTaskCounts {
  return { open: tasks.length, overdue: tasks.filter(task => isTaskOverdue(task, now)).length }
}

/** Sort key: soonest effective due first, undated last, then priority. */
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

export function compareTasks(a: TaskRow, b: TaskRow): number {
  const aDue = effectiveDueAt(a)
  const bDue = effectiveDueAt(b)
  if (aDue && bDue && aDue !== bDue) return aDue < bDue ? -1 : 1
  if (aDue && !bDue) return -1
  if (!aDue && bDue) return 1
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  if (byPriority !== 0) return byPriority
  return a.created_at < b.created_at ? -1 : 1
}

/** One matter/lead section of the task queue, in render order. */
export interface TaskRecordGroup {
  key: string
  label: string
  tasks: TaskRow[]
}

/**
 * Group tasks by the record they hang off — alphabetical by display name, with
 * unlinked work last. Keyed by record id, not name, so two clients who share a
 * name stay in separate sections.
 */
export function groupTasksByRecord(tasks: TaskRow[]): TaskRecordGroup[] {
  const NO_RECORD = 'none'
  const groups = new Map<string, TaskRecordGroup>()

  for (const task of tasks) {
    const key = task.matter_id ?? task.lead_id ?? NO_RECORD
    const label = key === NO_RECORD
      ? 'No related matter'
      : task.record_name?.trim() || 'Unnamed record'
    const existing = groups.get(key)
    if (existing) existing.tasks.push(task)
    else groups.set(key, { key, label, tasks: [task] })
  }

  const linked = [...groups.values()].filter(group => group.key !== NO_RECORD)
  linked.sort((a, b) => a.label.localeCompare(b.label))

  const unlinked = groups.get(NO_RECORD)
  const ordered = unlinked ? [...linked, unlinked] : linked
  for (const group of ordered) group.tasks.sort(compareTasks)
  return ordered
}

export function taskProgress(task: Pick<TaskRow, 'task_type' | 'status' | 'checklist'>): {
  done: number
  total: number
  isComplete: boolean
} {
  const checklist = task.checklist ?? []
  if (task.status === 'done') {
    if (task.task_type === 'checklist' && checklist.length > 0) {
      return { done: checklist.length, total: checklist.length, isComplete: true }
    }
    return { done: 1, total: 1, isComplete: true }
  }
  if (task.task_type === 'checklist') {
    const total = checklist.length
    const done = checklist.filter(item => item.done).length
    return { done, total: Math.max(total, 1), isComplete: total > 0 && done === total }
  }
  return { done: 0, total: 1, isComplete: false }
}

export function taskRecordHref(task: Pick<TaskRow, 'matter_id' | 'lead_id'>): string | null {
  if (task.matter_id) return `/admin/matters/${task.matter_id}`
  if (task.lead_id) return `/admin/crm/opportunities/${task.lead_id}`
  return null
}

// ── Display tokens ──────────────────────────────────────────────────────────

export const TASK_SOURCE_LABEL: Record<TaskSource, string> = {
  stage: 'Stage',
  manual: 'Manual',
  template: 'Template',
  cadence: 'Cadence',
  sla: 'Plan',
  prompt: 'Prompt',
  fiduciary: 'Fiduciary',
  identity: 'Identity',
}

/**
 * Each pill pairs a background token with a text token of the same hue. Note
 * that a `-bg` token's partner is never `--accent`: that is a *surface* colour
 * (what a row goes when you hover it), and using it as text is how the Plan
 * pill spent months at a 1.15:1 contrast ratio — grey on grey, invisible in
 * both themes. lib/theme/contrast.ts and the test over this map now hold every
 * pair to AA.
 */
export const TASK_SOURCE_PILL: Record<TaskSource, string> = {
  stage: 'bg-stage-work-bg text-stage-work-text',
  manual: 'bg-muted text-foreground',
  template: 'bg-blue-bg text-blue',
  cadence: 'bg-stage-active-bg text-stage-active-text',
  sla: 'bg-green-bg text-green',
  // 6.84:1 light, 8.48:1 dark, measured with lib/theme/contrast.ts against
  // the theme tokens rather than picked by eye. Amber is unused by the other
  // source pills, so the chip carries information at a glance, and it reads
  // as "a machine suggested this, someone still has to agree".
  prompt: 'bg-amber-bg text-amber',
  // 7.60:1 light, 6.26:1 dark, measured with lib/theme/contrast.ts against the
  // theme tokens rather than picked by eye. Unused by the other source pills,
  // and these are gaps in a plan rather than suggestions — `--red-strong` was
  // the first choice and fails AA in light at 3.95:1, which is why the pair is
  // measured and not assumed.
  fiduciary: 'bg-red-bg text-red',
  // 8.19:1 light, 8.30:1 dark, measured with lib/theme/contrast.ts. Violet was
  // added to the theme for this pill because every AA-passing pair already
  // there reads as a hue another source owns — stage-done is Plan's green,
  // stage-closed is Manual's grey, amber-strong is Prompt's amber. A name
  // disagreement is a fact about the file rather than a judgement about the
  // drafting, and it should not look like either of those.
  identity: 'bg-violet-bg text-violet',
}

export const TASK_PRIORITY_DOT: Record<TaskPriority, string> = {
  high: 'bg-red-strong',
  normal: 'bg-muted-foreground/50',
  low: 'bg-border',
}

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: 'High priority',
  normal: 'Normal priority',
  low: 'Low priority',
}

const DUE_SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

const DUE_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: FIRM_TIMEZONE,
})

const DUE_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: FIRM_TIMEZONE,
})

/** True when the due timestamp carries a real clock time, not just a date. */
function hasClockTime(iso: string): boolean {
  const local = new Date(iso).toLocaleTimeString('en-GB', { timeZone: FIRM_TIMEZONE, hour12: false })
  return local !== '00:00:00'
}

/** Short due label: "Today", "Tue", "Mar 4" — with the time when one was set. */
export function formatTaskDue(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const key = firmDateKey(iso)
  if (!key) return ''
  const todayKey = firmTodayKey(now)
  if (key === todayKey) {
    return hasClockTime(iso) ? `Today ${DUE_TIME.format(new Date(iso))}` : 'Today'
  }
  const yesterdayKey = firmTodayKey(new Date(now.getTime() - 86_400_000))
  if (key === yesterdayKey) return 'Yesterday'
  const tomorrowKey = firmTodayKey(new Date(now.getTime() + 86_400_000))
  if (key === tomorrowKey) return 'Tomorrow'
  const weekEnd = firmTodayKey(new Date(now.getTime() + 6 * 86_400_000))
  if (key > todayKey && key <= weekEnd) return DUE_WEEKDAY.format(new Date(iso))
  return DUE_SHORT.format(new Date(iso))
}

export function formatTaskDate(iso: string | null): string {
  if (!iso) return ''
  return DUE_SHORT.format(new Date(iso))
}

export function formatEstimate(minutes: number | null): string {
  if (!minutes || minutes <= 0) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function initialsFor(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function describeRecurrence(recurrence: TaskRecurrence | null): string {
  if (!recurrence) return ''
  const unit = recurrence.every === 1 ? recurrence.unit : `${recurrence.unit}s`
  const base = `Every ${recurrence.every} ${unit}`
  if (!recurrence.until) return base
  return `${base} until ${recurrence.until}`
}
