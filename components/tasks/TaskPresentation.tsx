'use client'

import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TaskDueCell } from './TaskPrimitives'
import type { TaskRow, TaskStatus } from '@/lib/tasks/types'
import { parseTaskPresentation, TASK_PRESENTATIONS, TASK_BOARD_COLUMNS, type TaskPresentation } from '@/lib/tasks/presentation'

export function useTaskPresentation() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const presentation = parseTaskPresentation(params?.get('presentation'))
  const selectPresentation = (value: TaskPresentation) => {
    const next = new URLSearchParams(params?.toString())
    next.set('presentation', value)
    router.replace(`${pathname}?${next}`, { scroll: false })
  }
  return { presentation, selectPresentation }
}

export function TaskPresentationSwitch({ value, onChange }: { value: TaskPresentation; onChange: (value: TaskPresentation) => void }) {
  return <div role="group" aria-label="Task presentation" className="inline-flex gap-1 rounded-lg border p-1">
    {TASK_PRESENTATIONS.map(item => <Button key={item} type="button" size="sm" variant={value === item ? 'secondary' : 'ghost'} aria-pressed={value === item} onClick={() => onChange(item)}>{item[0].toUpperCase() + item.slice(1)}</Button>)}
  </div>
}

/** Present the same task rows; all writes stay with the caller's existing actions. */
export function TaskPresentationView<T extends TaskRow>({ tasks, presentation, onOpen, onStatus, isPending, renderDetails }: {
  tasks: T[]
  presentation: TaskPresentation
  onOpen?: (task: T) => void
  onStatus?: (task: T, status: TaskStatus) => void
  isPending?: (id: string) => boolean
  renderDetails?: (task: T) => ReactNode
}) {
  const visible = tasks.filter(task => task.status !== 'archived')
  const statusControl = (task: T) => onStatus ? <select aria-label={`Status for ${task.title}`} className="max-w-full rounded border bg-background p-1 text-xs" value={task.status} disabled={isPending?.(task.id)} onChange={event => onStatus(task, event.target.value as TaskStatus)}>{TASK_BOARD_COLUMNS.map(column => <option key={column.status} value={column.status}>{column.label}</option>)}</select> : task.status.replaceAll('_', ' ')
  const content = (task: T) => renderDetails ? renderDetails(task) : <>
    <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen?.(task)}>{task.title}</button>
    <p className="text-xs text-muted-foreground">{task.record_name ?? 'Firm task'}</p>
    <p className="text-xs text-muted-foreground">{task.assignee_name ?? task.owner} · {task.priority}</p>
    <TaskDueCell task={task} />
    {statusControl(task)}
  </>
  if (presentation === 'board') return <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Task board">
    {TASK_BOARD_COLUMNS.map(column => {
      const rows = visible.filter(task => task.status === column.status)
      return <section key={column.status} className="min-w-0 rounded-lg bg-muted p-3"><h3 className="mb-3 text-sm font-semibold">{column.label} · {rows.length}</h3><div className="space-y-3">{rows.map(task => <article key={task.id} className="space-y-2 rounded-lg border bg-card p-3">{content(task)}</article>)}{!rows.length && <p className="text-xs text-muted-foreground">No tasks in this view</p>}</div></section>
    })}
  </div>
  if (presentation === 'table') return <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{['Task', 'Owner / Assignee', 'Due', 'Priority', 'Status'].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{visible.map(task => <tr key={task.id} className="border-t align-top"><td className="min-w-64 p-3">{renderDetails ? renderDetails(task) : <div><button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen?.(task)}>{task.title}</button>{task.record_name && <p className="text-xs text-muted-foreground">{task.record_name}</p>}</div>}</td><td className="p-3">{task.assignee_name ?? task.owner}</td><td className="whitespace-nowrap p-3"><TaskDueCell task={task} /></td><td className="p-3">{task.priority}</td><td className="p-3">{statusControl(task)}</td></tr>)}</tbody></table>{!visible.length && <p className="p-4 text-muted-foreground">No tasks in this view</p>}</div>
  return <div className="space-y-2">{visible.map(task => <article key={task.id} className="space-y-2 rounded-lg border p-3">{content(task)}</article>)}</div>
}
