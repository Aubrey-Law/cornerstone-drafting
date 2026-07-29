import { FIRM_TIMEZONE, firmDateKey, firmTodayKey } from '@/lib/firmDate'

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'archived'] as const
export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const
export const TASK_SOURCES = ['manual', 'stage', 'template', 'cadence'] as const
export const TASK_TYPES = ['single', 'checklist'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
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
  /** Joined for display — the matter/lead this task hangs off. */
  record_name?: string | null
  assignee_name?: string | null
}

export interface TaskTemplateRow {
  id: string
  name: string
  description: string | null
  items: Array<{ text: string; offset_days?: number; priority?: TaskPriority }>
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
  if (task.lead_id) return `/admin/leads/${task.lead_id}`
  return null
}

// ── Display tokens ──────────────────────────────────────────────────────────

export const TASK_SOURCE_LABEL: Record<TaskSource, string> = {
  stage: 'Stage',
  manual: 'Manual',
  template: 'Template',
  cadence: 'Cadence',
}

export const TASK_SOURCE_PILL: Record<TaskSource, string> = {
  stage: 'bg-stage-work-bg text-stage-work-text',
  manual: 'bg-muted text-foreground',
  template: 'bg-blue-bg text-blue',
  cadence: 'bg-stage-active-bg text-stage-active-text',
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
