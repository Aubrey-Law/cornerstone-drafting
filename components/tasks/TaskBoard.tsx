'use client'

import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { TASK_BOARD_COLUMNS } from '@/lib/tasks/presentation'
import {
  TASK_PRIORITY_LABEL,
  TASK_SOURCE_LABEL,
  effectiveDueAt,
  formatTaskDue,
  isTaskOverdue,
  type TaskRow,
  type TaskStatus,
} from '@/lib/tasks/types'

const COLUMN_DOT: Record<string, string> = {
  open: 'bg-input',
  in_progress: 'bg-selected-border',
  blocked: 'bg-amber-orange',
  done: 'bg-success',
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-destructive',
  normal: 'bg-input',
  low: 'bg-border',
}

const DRAG_TYPE = 'application/x-cornerstone-task'

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase()
}

/** Due pill tone: done green, overdue red, within two days amber, otherwise muted. */
export function dueTone(task: TaskRow, now: Date = new Date()): 'done' | 'overdue' | 'soon' | 'later' {
  if (task.status === 'done') return 'done'
  if (isTaskOverdue(task, now)) return 'overdue'
  const due = firmDateKey(effectiveDueAt(task))
  const soon = firmTodayKey(new Date(now.getTime() + 2 * 86_400_000))
  return due && due <= soon ? 'soon' : 'later'
}

const DUE_PILL = {
  done: 'bg-green-bg text-green',
  overdue: 'bg-status-overdue-bg text-status-overdue-text',
  soon: 'bg-amber-bg text-amber',
  later: 'bg-muted text-foreground/80',
} as const

/**
 * The Kanban board. Dragging a card between columns calls the caller's
 * `onStatus` — the same write the per-card status select makes, which stays as
 * the keyboard and screen-reader path. The move shows at once and reverts if
 * the write reports failure (`onStatus` resolving to null or false).
 */
export function TaskBoard<T extends TaskRow>({ tasks, onOpen, onStatus, isPending, renderDetails }: {
  tasks: T[]
  onOpen?: (task: T) => void
  onStatus?: (task: T, status: TaskStatus) => unknown
  isPending?: (id: string) => boolean
  renderDetails?: (task: T) => ReactNode
}) {
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const draggable = Boolean(onStatus) && !renderDetails

  // Drop an optimistic move once the refreshed rows agree with it.
  useEffect(() => {
    setMoved(current => {
      const next = { ...current }
      let changed = false
      for (const task of tasks) {
        if (next[task.id] && next[task.id] === task.status) { delete next[task.id]; changed = true }
      }
      return changed ? next : current
    })
  }, [tasks])

  const statusOf = (task: T): TaskStatus => moved[task.id] ?? task.status

  async function move(task: T, status: TaskStatus) {
    if (!onStatus || statusOf(task) === status) return
    setMoved(current => ({ ...current, [task.id]: status }))
    const result = await onStatus(task, status)
    if (result === null || result === false) {
      setMoved(current => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
    }
  }

  function drop(event: DragEvent, status: TaskStatus) {
    event.preventDefault()
    const id = event.dataTransfer.getData(DRAG_TYPE) || dragId
    setOverColumn(null)
    setDragId(null)
    const task = tasks.find(item => item.id === id)
    if (task) void move(task, status)
  }

  const visible = tasks.filter(task => task.status !== 'archived')
  return (
    <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 xl:grid-cols-4" aria-label="Task board">
      {TASK_BOARD_COLUMNS.map(column => {
        const rows = visible.filter(task => statusOf(task) === column.status)
        const over = overColumn === column.status
        return (
          <section
            key={column.status}
            aria-label={`${column.label} column`}
            data-drop-target={over || undefined}
            onDragOver={draggable ? event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverColumn(column.status) } : undefined}
            onDragLeave={draggable ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn(null) } : undefined}
            onDrop={draggable ? event => drop(event, column.status) : undefined}
            className={cn(
              'flex min-h-64 min-w-0 flex-col gap-2 rounded-lg bg-surface-2 p-2.5',
              over && 'bg-selected outline-2 outline-dashed outline-selected-border',
            )}
          >
            <h3 className="flex items-center justify-between text-compact font-semibold">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', COLUMN_DOT[column.status])} />
                {column.label}
              </span>
              <span className="sr-only"> · </span>
              <span className="font-medium text-muted-foreground">{rows.length}</span>
            </h3>
            {rows.map(task => {
              const status = statusOf(task)
              const done = status === 'done'
              const checklistDone = task.checklist?.filter(item => item.done).length ?? 0
              const due = effectiveDueAt(task)
              const tone = dueTone({ ...task, status })
              return (
                <article
                  key={task.id}
                  draggable={draggable}
                  onDragStart={draggable ? event => { event.dataTransfer.setData(DRAG_TYPE, task.id); event.dataTransfer.effectAllowed = 'move'; setDragId(task.id) } : undefined}
                  onDragEnd={draggable ? () => { setDragId(null); setOverColumn(null) } : undefined}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 transition-colors hover:border-input',
                    draggable && 'cursor-grab active:cursor-grabbing',
                    dragId === task.id && 'opacity-50',
                  )}
                >
                  {renderDetails ? renderDetails(task) : <>
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        aria-pressed={done}
                        disabled={!onStatus || isPending?.(task.id)}
                        onClick={() => void move(task, done ? 'open' : 'done')}
                        className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                          done ? 'bg-success text-success-foreground' : 'border-[1.5px] border-input bg-card hover:border-foreground')}
                      >
                        {done && <Check aria-hidden className="size-2.5" strokeWidth={3} />}
                      </button>
                      <button type="button" className={cn('min-w-0 flex-1 text-left font-medium hover:underline', done && 'text-muted-foreground line-through')} onClick={() => onOpen?.(task)}>
                        {task.title}
                      </button>
                      <span role="img" aria-label={TASK_PRIORITY_LABEL[task.priority] ?? `${task.priority} priority`} className={cn('mt-1.5 size-2 shrink-0 rounded-full', PRIORITY_DOT[task.priority] ?? 'bg-input')} />
                    </div>
                    {task.description && <p className="line-clamp-2 pl-6 text-xs text-muted-foreground">{task.description}</p>}
                    {task.checklist?.length > 0 && <p className="pl-6 text-micro text-muted-foreground">Checklist {checklistDone}/{task.checklist.length}</p>}
                    <div className="flex items-center justify-between gap-1.5 pl-6 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span title={task.assignee_name ?? task.owner} className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-semibold text-foreground">
                          {task.assignee_name ? initials(task.assignee_name) : task.owner === 'client' ? 'CL' : task.owner === 'automation' ? 'AU' : '—'}
                        </span>
                        <span className="truncate">{TASK_SOURCE_LABEL[task.source] ?? task.source}</span>
                      </span>
                      {due && <span className={cn('shrink-0 rounded-md px-2 py-px font-medium tabular-nums', DUE_PILL[tone])}>{formatTaskDue(due)}</span>}
                    </div>
                    {onStatus && (
                      <select
                        aria-label={`Status for ${task.title}`}
                        className="h-6 max-w-full rounded-sm border bg-card px-1 text-micro text-muted-foreground"
                        value={status}
                        disabled={isPending?.(task.id)}
                        onChange={event => void move(task, event.target.value as TaskStatus)}
                      >
                        {TASK_BOARD_COLUMNS.map(option => <option key={option.status} value={option.status}>{option.label}</option>)}
                      </select>
                    )}
                  </>}
                </article>
              )
            })}
            {!rows.length && <p className="text-xs text-muted-foreground">No tasks in this view</p>}
          </section>
        )
      })}
    </div>
  )
}
