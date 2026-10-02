'use client'

import Link from 'next/link'
import { Paperclip, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TASK_PRIORITY_DOT,
  TASK_PRIORITY_LABEL,
  TASK_SOURCE_LABEL,
  TASK_SOURCE_PILL,
  effectiveDueAt,
  formatEstimate,
  formatTaskDue,
  initialsFor,
  isTaskOverdue,
  taskProgress,
  taskRecordHref,
  type TaskRow,
} from '@/lib/tasks/types'
import type { TaskWorkSummary } from '@/lib/work/taskSummary'

const WORK_BAND_LABEL: Record<TaskWorkSummary['priorityBand'], string> = {
  0: 'Critical',
  1: 'Today',
  2: 'Soon',
  3: 'Planned',
  4: 'Waiting',
}

export function TaskSourcePill({ source, className }: { source: TaskRow['source']; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-micro font-medium',
        TASK_SOURCE_PILL[source],
        className,
      )}
    >
      {TASK_SOURCE_LABEL[source]}
    </span>
  )
}

export function TaskPriorityDot({ priority }: { priority: TaskRow['priority'] }) {
  return (
    <span
      aria-label={TASK_PRIORITY_LABEL[priority]}
      title={TASK_PRIORITY_LABEL[priority]}
      className={cn('size-1.5 shrink-0 rounded-full', TASK_PRIORITY_DOT[priority])}
    />
  )
}

export function TaskAssigneeAvatar({ name }: { name: string | null | undefined }) {
  if (!name) return null
  return (
    <span
      title={name}
      className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-micro font-medium text-muted-foreground"
    >
      {initialsFor(name)}
    </span>
  )
}

/** Right-aligned due cell — red once the effective due date has passed. */
export function TaskDueCell({ task, className }: { task: TaskRow; className?: string }) {
  const due = effectiveDueAt(task)
  if (!due) return null
  const overdue = isTaskOverdue(task)
  return (
    <span
      title={new Date(due).toLocaleString()}
      className={cn(
        'shrink-0 text-xs tabular-nums',
        overdue ? 'font-medium text-red-strong' : 'text-muted-foreground',
        className,
      )}
    >
      {formatTaskDue(due)}
    </span>
  )
}

/** Checkbox styled as a plain circle so long lists stay quiet. */
export function TaskCheckbox({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Reopen ${label}` : `Complete ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        checked
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-muted-foreground/40 hover:border-foreground',
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M2 6.5 4.6 9 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

/** The record link + source pill + subtask count line under a task title. */
export function TaskMetaLine({ task, showRecord = true }: { task: TaskRow; showRecord?: boolean }) {
  const href = taskRecordHref(task)
  const progress = taskProgress(task)
  const showSubtasks = task.task_type === 'checklist' && task.checklist.length > 0

  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {showRecord && href && task.record_name && (
        <>
          <Link href={href} className="truncate hover:text-foreground hover:underline">
            {task.record_name}
          </Link>
          <span aria-hidden>·</span>
        </>
      )}
      <TaskSourcePill source={task.source} />
      {showSubtasks && (
        <>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">
            {progress.done}/{progress.total} subtasks
          </span>
        </>
      )}
    </span>
  )
}

interface TaskRowProps {
  task: TaskRow
  workSummary?: TaskWorkSummary
  focused?: boolean
  /** Held in a multi-row selection. Distinct from `focused`, which is the one
   *  row the keyboard is pointing at — a selection can be many rows wide and
   *  outlives the cursor moving on. */
  selected?: boolean
  /** When given, the row leads with a select box for bulk actions. Square and
   *  set apart from the round complete checkbox so the two never read alike. */
  onToggleSelected?: () => void
  pending?: boolean
  showRecord?: boolean
  onComplete: () => void
  onToggleSubtask?: (index: number, done: boolean) => void
  onOpen?: () => void
  /** Trailing controls (snooze menu, overflow) rendered after the due cell. */
  actions?: React.ReactNode
}

/**
 * One task in a list: checkbox → priority dot → title → meta line → estimate →
 * assignee → due. Shared by the Tasks page, the record tab and Today.
 */
export function TaskListRow({
  task,
  workSummary,
  focused = false,
  selected = false,
  onToggleSelected,
  pending = false,
  showRecord = true,
  onComplete,
  onToggleSubtask,
  onOpen,
  actions,
}: TaskRowProps) {
  const done = task.status === 'done'
  const estimate = formatEstimate(task.estimate_minutes)

  return (
    <li
      id={`task-row-${task.id}`}
      data-selected={selected || undefined}
      className={cn(
        'transition-colors hover:bg-accent',
        focused && 'bg-muted shadow-[inset_3px_0_0] shadow-primary',
        // Deliberately a different channel from focus: focus is a left edge
        // bar, selection is the row's own fill. Both can be true at once and
        // have to stay legible together.
        selected && 'bg-blue-bg hover:bg-blue-bg',
        selected && focused && 'shadow-[inset_3px_0_0] shadow-primary',
        pending && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        {/*
          Selection used to be announced with `aria-selected` on this <li>. A
          bare <li> is a `listitem`, which does not support that attribute, so
          it was dropped and a screen reader heard nothing — on a list whose
          selection drives bulk assignment.

          The obvious repair, `role="option"` inside a listbox, is the wrong
          one: an option must not contain focusable widgets, and each row holds
          a checkbox, a snooze menu and an open action. So the state is said in
          words instead. The count is already announced by the selection bar's
          `role="status"`; this is the per-row half of it.
        */}
        {selected && <span className="sr-only">Selected. </span>}
        {onToggleSelected && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${task.title}`}
            className="size-3.5 shrink-0 cursor-pointer rounded-sm accent-primary"
          />
        )}
        <TaskCheckbox checked={done} disabled={pending} label={task.title} onToggle={onComplete} />
        <TaskPriorityDot priority={task.priority} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              disabled={!onOpen}
              className={cn(
                'truncate text-left text-sm text-foreground disabled:cursor-default',
                onOpen && 'hover:underline',
                done && 'text-muted-foreground line-through',
              )}
            >
              {task.title}
            </button>
            {task.recurrence && (
              <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Repeats" />
            )}
            {task.document_id && (
              <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label="Has an attachment" />
            )}
          </span>
          <TaskMetaLine task={task} showRecord={showRecord} />
          {workSummary && (
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
              <span className={cn(
                'rounded px-1.5 py-0.5 font-semibold',
                workSummary.priorityBand === 0
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-muted text-muted-foreground',
              )}>
                {WORK_BAND_LABEL[workSummary.priorityBand]}
              </span>
              {workSummary.priorityReasons.map(reason => (
                <span key={reason.code} className="truncate">{reason.label}</span>
              ))}
            </span>
          )}
        </span>
        {estimate && (
          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">{estimate}</span>
        )}
        <TaskAssigneeAvatar name={task.assignee_name} />
        <TaskDueCell task={task} className="w-16 text-right" />
        {actions}
      </div>
      {task.checklist.length > 0 && (
        <ul className="space-y-1 pb-2 pl-12 pr-3">
          {task.checklist.map((item, index) => (
            <li key={index} className="flex items-center gap-2 text-xs">
              <TaskCheckbox
                checked={item.done}
                disabled={pending || !onToggleSubtask}
                label={item.text}
                onToggle={() => onToggleSubtask?.(index, !item.done)}
              />
              <span className={cn('min-w-0 truncate text-foreground', item.done && 'text-muted-foreground line-through')}>
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
