'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import {
  compareTasks,
  formatTaskDate,
  initialsFor,
  isTaskOpen,
  isTaskOverdue,
  taskProgress,
  type TaskRow,
} from '@/lib/tasks/types'
import { Checkbox } from '@/components/ui/checkbox'
import { TaskComposer, type TaskComposerHandle } from '@/components/tasks/TaskComposer'
import { TaskDetailSheet, type TaskAssigneeOption } from '@/components/tasks/TaskDetailSheet'
import { TaskCheckbox, TaskDueCell, TaskSourcePill } from '@/components/tasks/TaskPrimitives'
import { useTaskActions } from '@/components/tasks/useTaskActions'
import { railRecordForPath } from './RailActivityPane'

type ScopeKey = 'record' | 'mine' | 'team'

interface RailTasksPaneProps {
  /** Focus the capture input when the pane opens via ⌘⇧T. */
  captureRequestId: number
}

export function RailTasksPane({ captureRequestId }: RailTasksPaneProps) {
  const pathname = usePathname()
  const token = useAccessToken()
  const record = railRecordForPath(pathname ?? '')
  const composerRef = useRef<TaskComposerHandle>(null)

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [recordTasks, setRecordTasks] = useState<TaskRow[]>([])
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeKey>(record ? 'record' : 'mine')
  const [doneOpen, setDoneOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [assignees, setAssignees] = useState<TaskAssigneeOption[]>([])
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)

  const recordId = record?.id ?? null
  const recordType = record?.type ?? null

  // On a record route the rail defaults to that record; elsewhere to Mine.
  useEffect(() => {
    setScope(recordId ? 'record' : 'mine')
  }, [recordId])

  useEffect(() => {
    if (captureRequestId > 0) composerRef.current?.focus()
  }, [captureRequestId])

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const requests: Array<Promise<Response>> = [
        fetch('/api/admin/tasks?status=open', { headers: authHeaders, cache: 'no-store' }),
        fetch('/api/admin/tasks/assignees', { headers: authHeaders }),
      ]
      if (recordId) {
        requests.push(
          fetch(`/api/admin/tasks?status=all&recordId=${recordId}`, { headers: authHeaders, cache: 'no-store' }),
        )
      }
      const [openRes, meRes, recordRes] = await Promise.all(requests)

      const openJson = openRes.ok ? await openRes.json() : { tasks: [] }
      setTasks((openJson.tasks ?? []) as TaskRow[])

      if (meRes.ok) {
        const meJson = await meRes.json()
        setViewerId((meJson.viewerId ?? null) as string | null)
        setAssignees((meJson.assignees ?? []) as TaskAssigneeOption[])
      }
      if (recordRes?.ok) {
        const recordJson = await recordRes.json()
        setRecordTasks((recordJson.tasks ?? []) as TaskRow[])
      } else {
        setRecordTasks([])
      }
    } catch {
      setTasks([])
      setRecordTasks([])
    } finally {
      setLoading(false)
    }
  }, [authHeaders, recordId])

  useEffect(() => {
    void load()
  }, [load])

  const actions = useTaskActions(() => void load())

  const counts = useMemo(() => ({
    record: recordTasks.filter(isTaskOpen).length,
    mine: tasks.filter(t => t.assignee_id === viewerId).length,
    team: tasks.filter(t => t.assignee_id && t.assignee_id !== viewerId).length,
  }), [recordTasks, tasks, viewerId])

  const listed = useMemo(() => {
    const source = scope === 'record' ? recordTasks.filter(isTaskOpen) : tasks
    const filtered = scope === 'mine'
      ? source.filter(t => t.assignee_id === viewerId)
      : scope === 'team'
        ? source.filter(t => t.assignee_id && t.assignee_id !== viewerId)
        : source
    // The stage-task card above already owns the open stage task.
    return filtered.filter(t => !(scope === 'record' && t.source === 'stage')).sort(compareTasks)
  }, [scope, recordTasks, tasks, viewerId])

  const doneOnRecord = useMemo(
    () => recordTasks.filter(t => t.status === 'done').sort(compareTasks),
    [recordTasks],
  )

  const stageTask = useMemo(
    () => recordTasks.find(t => t.source === 'stage' && isTaskOpen(t)) ?? null,
    [recordTasks],
  )

  const recordName = recordTasks[0]?.record_name ?? null

  const toggle = useCallback(
    async (task: TaskRow) => {
      if (task.status === 'done') await actions.reopen(task)
      else await actions.complete(task)
    },
    [actions],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <TaskComposer
          ref={composerRef}
          defaultRecord={
            recordId && recordType
              ? { id: recordId, name: recordName ?? 'This record', kind: recordType, detail: null }
              : null
          }
          onCreate={async input => {
            const created = await actions.create(input)
            if (created) await load()
            return created
          }}
          onApplyTemplate={templateId => {
            if (!recordId || !recordType) return
            void actions.applyTemplate(templateId, {
              matter_id: recordType === 'matter' ? recordId : null,
              lead_id: recordType === 'lead' ? recordId : null,
            })
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-center gap-1 rounded-md bg-muted p-0.5 text-xs">
          {record && (
            <ScopeButton
              active={scope === 'record'}
              onClick={() => setScope('record')}
              label="This matter"
              count={counts.record}
            />
          )}
          <ScopeButton active={scope === 'mine'} onClick={() => setScope('mine')} label="Mine" count={counts.mine} />
          <ScopeButton active={scope === 'team'} onClick={() => setScope('team')} label="Team" count={counts.team} />
        </div>

        {record && scope === 'record' && (
          <p className="mt-2 flex items-center gap-1.5 truncate text-micro text-muted-foreground">
            Scoped to <span className="font-medium text-foreground">{recordName ?? 'this record'}</span>
            {stageTask?.stage_key && (
              <span className="rounded bg-stage-work-bg px-1.5 py-0.5 text-micro font-medium text-stage-work-text">
                {engineStageLabel(stageTask.stage_key)}
              </span>
            )}
          </p>
        )}

        {scope === 'record' && stageTask && <RailStageTaskCard task={stageTask} onToggle={actions.toggleChecklistItem} />}

        <h3 className="px-1 pb-1 pt-3 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          {scope === 'record' ? 'Open on this matter' : scope === 'mine' ? 'Open — mine' : 'Open — team'}
        </h3>

        {loading && listed.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">Loading tasks…</p>
        ) : listed.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-medium">Nothing open here</p>
            <p className="mt-1 text-xs text-muted-foreground">Add one above — it lands in the main queue too.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {listed.map(task => (
              <li key={task.id} className="flex items-center gap-2 px-2 py-1.5">
                <TaskCheckbox
                  checked={task.status === 'done'}
                  disabled={actions.isPending(task.id)}
                  label={task.title}
                  onToggle={() => void toggle(task)}
                />
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSelectedTask(task)}
                    className="block w-full truncate text-left text-compact text-foreground hover:underline"
                  >
                    {task.title}
                  </button>
                  <span className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                    <TaskSourcePill source={task.source} />
                    {task.assignee_name && <span>{initialsFor(task.assignee_name)}</span>}
                    {scope !== 'record' && task.record_name && (
                      <span className="truncate">{task.record_name}</span>
                    )}
                  </span>
                </span>
                <TaskDueCell task={task} />
              </li>
            ))}
          </ul>
        )}

        {record && doneOnRecord.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setDoneOpen(prev => !prev)}
              aria-expanded={doneOpen}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {doneOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              Done on this matter · {doneOnRecord.length}
            </button>
            {doneOpen && (
              <ul className="divide-y divide-border border-t border-border">
                {doneOnRecord.map(task => (
                  <li key={task.id} className="flex items-center gap-2 px-2 py-1.5">
                    <TaskCheckbox
                      checked
                      disabled={actions.isPending(task.id)}
                      label={task.title}
                      onToggle={() => void toggle(task)}
                    />
                    <span className="min-w-0 flex-1 truncate text-compact text-muted-foreground line-through">
                      {task.title}
                    </span>
                    <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
                      {formatTaskDate(task.completed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <Link
          href="/admin/tasks"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Open Tasks
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <TaskDetailSheet
        task={selectedTask}
        assignees={assignees}
        open={Boolean(selectedTask)}
        onOpenChange={open => {
          if (!open) setSelectedTask(null)
        }}
        onUpdated={updated => {
          setSelectedTask(updated)
          void load()
        }}
        onDeleted={() => {
          setSelectedTask(null)
          void load()
        }}
      />
    </div>
  )
}

function ScopeButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex-1 truncate rounded px-2 py-1 transition-colors',
        active ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label} <span className="tabular-nums">· {count}</span>
    </button>
  )
}

/** The amber SLA card: which stage, how far into the SLA, and the checklist. */
function RailStageTaskCard({
  task,
  onToggle,
}: {
  task: TaskRow
  onToggle: (task: TaskRow, index: number, done: boolean) => Promise<TaskRow | null>
}) {
  const progress = taskProgress(task)
  const overdue = isTaskOverdue(task)

  const slaDay = useMemo(() => {
    if (!task.stage_entered_at || !task.hard_due_at) return null
    const start = new Date(task.stage_entered_at).getTime()
    const end = new Date(task.hard_due_at).getTime()
    const total = Math.max(1, Math.round((end - start) / 86_400_000))
    const elapsed = Math.min(total, Math.max(1, Math.round((Date.now() - start) / 86_400_000) + 1))
    return { elapsed, total }
  }, [task.stage_entered_at, task.hard_due_at])

  return (
    <div className="mt-3 rounded-lg border border-amber-border bg-amber-bg p-2.5">
      <p className="text-micro font-semibold uppercase tracking-wide text-amber-orange">
        Stage task
        {slaDay && ` · SLA day ${slaDay.elapsed} of ${slaDay.total}`}
      </p>
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="min-w-0 text-compact font-medium text-foreground">{task.title}</p>
        <span className={cn('shrink-0 text-xs tabular-nums', overdue ? 'text-red-strong' : 'text-amber-orange')}>
          {progress.done}/{progress.total}
        </span>
      </div>
      {task.checklist.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {task.checklist.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-compact">
              <Checkbox
                id={`rail-stage-${task.id}-${index}`}
                checked={item.done}
                onCheckedChange={checked => void onToggle(task, index, checked === true)}
                className="mt-0.5"
              />
              <label
                htmlFor={`rail-stage-${task.id}-${index}`}
                className={cn('leading-snug', item.done && 'text-muted-foreground line-through')}
              >
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
