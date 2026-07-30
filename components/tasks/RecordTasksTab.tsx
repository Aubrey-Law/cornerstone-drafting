'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Plus, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import {
  TASK_SOURCES,
  TASK_SOURCE_LABEL,
  compareTasks,
  describeRecurrence,
  formatTaskDate,
  initialsFor,
  isTaskOpen,
  isTaskOverdue,
  taskProgress,
  type TaskRow,
  type TaskSource,
} from '@/lib/tasks/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TaskComposer } from './TaskComposer'
import { TaskDetailSheet, type TaskAssigneeOption } from './TaskDetailSheet'
import { TaskCheckbox, TaskDueCell, TaskPriorityDot, TaskSourcePill } from './TaskPrimitives'
import { useTaskActions } from './useTaskActions'

interface TemplateOption {
  id: string
  name: string
  items: Array<{ text: string }>
}

export interface RecordTasksTabProps {
  recordId: string
  recordKind: 'matter' | 'lead'
  recordName: string | null
  /** Called after a stage task's last checklist item lands, so the record page
   *  can re-read the stage engine and offer to advance. */
  onStageTaskCompleted?: () => void
  /** Called whenever the record's tasks change, so the tab badge can refresh. */
  onTasksChanged?: () => void
}

/**
 * The Tasks tab shared by the matter and lead record pages. Left column is the
 * working queue; the right rail carries cadence, templates and recent history.
 */
export function RecordTasksTab({
  recordId,
  recordKind,
  recordName,
  onStageTaskCompleted,
  onTasksChanged,
}: RecordTasksTabProps) {
  const token = useAccessToken()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'open' | 'done'>('open')
  const [sourceFilter, setSourceFilter] = useState<TaskSource | 'all'>('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
  const [assignees, setAssignees] = useState<TaskAssigneeOption[]>([])

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tasks?status=all&recordId=${recordId}`, {
        headers: authHeaders,
        cache: 'no-store',
      })
      const json = res.ok ? await res.json() : { tasks: [] }
      setTasks((json.tasks ?? []) as TaskRow[])
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [recordId, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void fetch('/api/admin/task-templates', { headers: authHeaders })
      .then(res => (res.ok ? res.json() : { templates: [] }))
      .then(json => setTemplates((json.templates ?? []) as TemplateOption[]))
      .catch(() => setTemplates([]))
  }, [authHeaders])

  useEffect(() => {
    void fetch('/api/admin/tasks/assignees', { headers: authHeaders })
      .then(res => (res.ok ? res.json() : { assignees: [] }))
      .then(json => setAssignees((json.assignees ?? []) as TaskAssigneeOption[]))
      .catch(() => setAssignees([]))
  }, [authHeaders])

  const actions = useTaskActions(() => {
    void load()
    onTasksChanged?.()
  })

  const recordBinding = useMemo(
    () => ({
      matter_id: recordKind === 'matter' ? recordId : null,
      lead_id: recordKind === 'lead' ? recordId : null,
    }),
    [recordKind, recordId],
  )

  const open = useMemo(() => tasks.filter(isTaskOpen).sort(compareTasks), [tasks])
  const done = useMemo(
    () => tasks.filter(t => t.status === 'done').sort((a, b) => (a.completed_at ?? '') < (b.completed_at ?? '') ? 1 : -1),
    [tasks],
  )

  const stageTask = useMemo(() => open.find(t => t.source === 'stage') ?? null, [open])

  const listed = useMemo(() => {
    const base = view === 'open' ? open.filter(t => t.id !== stageTask?.id) : done
    return sourceFilter === 'all' ? base : base.filter(t => t.source === sourceFilter)
  }, [view, open, done, stageTask, sourceFilter])

  const cadences = useMemo(() => open.filter(t => t.recurrence), [open])

  const appliedTemplates = useMemo(() => {
    const byTemplate = new Map<string, { name: string; total: number; done: number }>()
    for (const task of tasks) {
      if (!task.template_id) continue
      const name = templates.find(t => t.id === task.template_id)?.name ?? 'Template'
      const entry = byTemplate.get(task.template_id) ?? { name, total: 0, done: 0 }
      entry.total += 1
      if (task.status === 'done') entry.done += 1
      byTemplate.set(task.template_id, entry)
    }
    return [...byTemplate.entries()].map(([id, value]) => ({ id, ...value }))
  }, [tasks, templates])

  const toggle = useCallback(
    async (task: TaskRow) => {
      const updated = task.status === 'done' ? await actions.reopen(task) : await actions.complete(task)
      // Finishing a stage task is what lets the matter advance; a manual task
      // never touches the stage engine.
      if (updated?.status === 'done' && task.source === 'stage') onStageTaskCompleted?.()
    },
    [actions, onStageTaskCompleted],
  )

  const toggleChecklistItem = useCallback(
    async (task: TaskRow, index: number, checked: boolean) => {
      const updated = await actions.toggleChecklistItem(task, index, checked)
      if (updated?.status === 'done' && task.source === 'stage') onStageTaskCompleted?.()
    },
    [actions, onStageTaskCompleted],
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('open')}
              aria-pressed={view === 'open'}
              className={cn(
                'rounded px-2 py-1 transition-colors',
                view === 'open' ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground',
              )}
            >
              Open · {open.length}
            </button>
            <button
              type="button"
              onClick={() => setView('done')}
              aria-pressed={view === 'done'}
              className={cn(
                'rounded px-2 py-1 transition-colors',
                view === 'done' ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground',
              )}
            >
              Done · {done.length}
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                {sourceFilter === 'all' ? 'All sources' : TASK_SOURCE_LABEL[sourceFilter]}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuLabel className="text-xs">Source</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setSourceFilter('all')}>All sources</DropdownMenuItem>
              {TASK_SOURCES.map(source => (
                <DropdownMenuItem key={source} onSelect={() => setSourceFilter(source)}>
                  {TASK_SOURCE_LABEL[source]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={templates.length === 0}>
                <Layers className="size-3.5" />
                Apply template
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs">Apply a template</DropdownMenuLabel>
              {templates.map(template => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() => void actions.applyTemplate(template.id, recordBinding)}
                >
                  <span className="truncate">{template.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{template.items?.length ?? 0}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setComposerOpen(prev => !prev)}
          >
            <Plus className="size-3.5" />
            Add task
          </Button>
        </div>

        {composerOpen && (
          <TaskComposer
            className="border-border"
            lockRecord
            defaultRecord={{ id: recordId, name: recordName ?? 'This record', kind: recordKind, detail: null }}
            onCreate={async input => {
              const created = await actions.create({ ...input, ...recordBinding })
              if (created) await load()
              return created
            }}
            onApplyTemplate={templateId => void actions.applyTemplate(templateId, recordBinding)}
          />
        )}

        {stageTask && view === 'open' && (
          <StageTaskCard task={stageTask} onToggleItem={toggleChecklistItem} onComplete={() => void toggle(stageTask)} />
        )}

        {loading && tasks.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">Loading tasks…</p>
        ) : listed.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">
              {view === 'open' ? 'Nothing open on this record' : 'Nothing completed yet'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a task above, or apply a template to lay out the usual steps.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {listed.map(task => (
              <li key={task.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50">
                <TaskCheckbox
                  checked={task.status === 'done'}
                  disabled={actions.isPending(task.id)}
                  label={task.title}
                  onToggle={() => void toggle(task)}
                />
                <TaskPriorityDot priority={task.priority} />
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSelectedTask(task)}
                    className={cn('flex items-center gap-1.5 truncate text-left text-sm text-foreground hover:underline', task.status === 'done' && 'text-muted-foreground line-through')}
                  >
                    {task.title}
                    {task.recurrence && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Repeats" />}
                  </button>
                  {task.description && (
                    <span className="block truncate text-xs text-muted-foreground">{task.description}</span>
                  )}
                  {task.checklist.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {task.checklist.map((item, index) => (
                        <li key={index} className="flex items-center gap-2 text-xs">
                          <TaskCheckbox
                            checked={item.done}
                            disabled={actions.isPending(task.id)}
                            label={item.text}
                            onToggle={() => void toggleChecklistItem(task, index, !item.done)}
                          />
                          <span className={cn('truncate text-foreground', item.done && 'text-muted-foreground line-through')}>
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
                <TaskSourcePill source={task.source} />
                {task.assignee_name && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {initialsFor(task.assignee_name)}
                  </span>
                )}
                <TaskDueCell task={task} className="w-16 text-right" />
              </li>
            ))}
          </ul>
        )}

        {view === 'open' && done.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setDoneOpen(prev => !prev)}
              aria-expanded={doneOpen}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              {doneOpen ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
              Done · {done.length}
            </button>
            {doneOpen && (
              <ul className="divide-y divide-border border-t border-border">
                {done.map(task => (
                  <li key={task.id} className="flex items-center gap-3 px-3 py-2">
                    <TaskCheckbox checked label={task.title} onToggle={() => void toggle(task)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatTaskDate(task.completed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <RailCard title="Follow-up cadence">
          {cadences.length === 0 ? (
            <p className="text-xs text-muted-foreground">No repeating follow-ups on this record.</p>
          ) : (
            <ul className="space-y-2">
              {cadences.map(task => (
                <li key={task.id} className="text-xs">
                  <p className="truncate font-medium text-foreground">{task.title}</p>
                  <p className="text-muted-foreground">{describeRecurrence(task.recurrence)}</p>
                  <p className="text-muted-foreground">
                    Next {formatTaskDate(task.due_at ?? task.soft_due_at)}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="font-medium text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        void actions.patch(task.id, {
                          recurrence: { ...task.recurrence, paused: !task.recurrence?.paused },
                        })
                      }
                    >
                      {task.recurrence?.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      className="font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => void actions.patch(task.id, { recurrence: null })}
                    >
                      Stop repeating
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        <RailCard title="Applied templates">
          {appliedTemplates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No templates applied yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {appliedTemplates.map(entry => (
                <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{entry.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {entry.total} task{entry.total === 1 ? '' : 's'} · {entry.done} done
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RailCard>

        <RailCard title="Recently completed">
          {done.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing completed yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {done.slice(0, 2).map(task => (
                <li key={task.id} className="text-xs">
                  <p className="truncate text-foreground">{task.title}</p>
                  <p className="text-muted-foreground">
                    {formatTaskDate(task.completed_at)}
                    {task.assignee_name ? ` · ${initialsFor(task.assignee_name)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </RailCard>
      </aside>
      <TaskDetailSheet
        task={selectedTask}
        assignees={assignees}
        open={Boolean(selectedTask)}
        onOpenChange={open => {
          if (!open) setSelectedTask(null)
        }}
        onUpdated={updated => {
          setTasks(current => current.map(task => task.id === updated.id ? updated : task))
          setSelectedTask(updated)
          onTasksChanged?.()
        }}
        onDeleted={deleted => {
          setTasks(current => current.filter(task => task.id !== deleted.id))
          setSelectedTask(null)
          onTasksChanged?.()
        }}
      />
    </div>
  )
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  )
}

function StageTaskCard({
  task,
  onToggleItem,
  onComplete,
}: {
  task: TaskRow
  onToggleItem: (task: TaskRow, index: number, checked: boolean) => void
  onComplete: () => void
}) {
  const progress = taskProgress(task)
  const overdue = isTaskOverdue(task)
  const percent = Math.round((progress.done / Math.max(1, progress.total)) * 100)

  return (
    <div className="rounded-lg border border-amber-border bg-amber-bg p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-orange">
            Stage task · {engineStageLabel(task.stage_key ?? '')}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{task.title}</p>
        </div>
        <div className="text-right text-xs">
          {task.soft_due_at && <p className="text-muted-foreground">Due {formatTaskDate(task.soft_due_at)}</p>}
          {task.hard_due_at && (
            <p className={cn('tabular-nums', overdue ? 'font-medium text-red-strong' : 'text-amber-orange')}>
              SLA {formatTaskDate(task.hard_due_at)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className={cn('h-full rounded-full', overdue ? 'bg-red-strong' : 'bg-amber-orange')}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {progress.done}/{progress.total}
        </span>
      </div>

      {task.checklist.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {task.checklist.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`record-stage-${task.id}-${index}`}
                checked={item.done}
                onCheckedChange={checked => onToggleItem(task, index, checked === true)}
                className="mt-0.5"
              />
              <label
                htmlFor={`record-stage-${task.id}-${index}`}
                className={cn('leading-snug', item.done && 'text-muted-foreground line-through')}
              >
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <Button type="button" size="sm" variant="outline" className="mt-3 h-7 text-xs" onClick={onComplete}>
          Mark complete
        </Button>
      )}
    </div>
  )
}
