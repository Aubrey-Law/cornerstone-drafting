'use client'

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ListPlus, Plus, Repeat, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { parseCapture } from '@/lib/tasks/parseCapture'
import { formatTaskDue, TASK_PRIORITIES, type TaskPriority, type TaskRecurrence, type TaskRow } from '@/lib/tasks/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CreateTaskInput } from './useTaskActions'

interface RecordOption {
  id: string
  name: string
  kind: 'matter' | 'lead'
  detail: string | null
}

interface TemplateOption {
  id: string
  name: string
  items: Array<{ text: string }>
}

interface AssigneeOption {
  id: string
  name: string
}

export interface TaskComposerHandle {
  focus: () => void
}

interface TaskComposerProps {
  /** Pre-bound record, e.g. the matter whose tab the composer sits on. */
  defaultRecord?: RecordOption | null
  /** Hides the record chip and picker when the record can't change. */
  lockRecord?: boolean
  onCreate: (input: CreateTaskInput) => Promise<TaskRow | null>
  onApplyTemplate?: (templateId: string) => void
  placeholder?: string
  shortcutHint?: string
  className?: string
  ref?: React.Ref<TaskComposerHandle>
}

const REPEAT_PRESETS: Array<{ label: string; recurrence: TaskRecurrence }> = [
  { label: 'Every week', recurrence: { every: 1, unit: 'week' } },
  { label: 'Every 2 weeks', recurrence: { every: 2, unit: 'week' } },
  { label: 'Every month', recurrence: { every: 1, unit: 'month' } },
]

function Chip({
  children,
  onClear,
  dashed = false,
  onClick,
}: {
  children: React.ReactNode
  onClear?: () => void
  dashed?: boolean
  onClick?: () => void
}) {
  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
        dashed
          ? 'border border-dashed border-border text-muted-foreground'
          : 'bg-muted text-foreground',
      )}
    >
      {children}
      {onClear && (
        <button
          type="button"
          onClick={event => {
            event.stopPropagation()
            onClear()
          }}
          aria-label="Clear"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
  if (!onClick) return content
  return (
    <button type="button" onClick={onClick} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
      {content}
    </button>
  )
}

/**
 * Quick capture. Collapsed it is a single input; focused it expands into a card
 * with the chips parsed out of what was typed. `@` opens the record picker and
 * `/` the template picker — both driven by what follows the trigger character.
 */
export function TaskComposer({
  defaultRecord = null,
  lockRecord = false,
  onCreate,
  onApplyTemplate,
  placeholder = 'Add a task — @record, /template, "Fri 2pm"',
  shortcutHint = '⌘⇧T',
  className,
  ref,
}: TaskComposerProps) {
  const token = useAccessToken()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [record, setRecord] = useState<RecordOption | null>(defaultRecord)
  const [assignee, setAssignee] = useState<AssigneeOption | null>(null)
  const [priority, setPriority] = useState<TaskPriority | null>(null)
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null)
  const [subtasks, setSubtasks] = useState<string[]>([])
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  const [records, setRecords] = useState<RecordOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [assignees, setAssignees] = useState<AssigneeOption[]>([])

  useEffect(() => {
    setRecord(defaultRecord)
  }, [defaultRecord])

  useImperativeHandle(ref, () => ({
    focus: () => {
      setExpanded(true)
      inputRef.current?.focus()
    },
  }), [])

  const parsed = useMemo(() => parseCapture(value), [value])
  const effectivePriority = priority ?? parsed.priority
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )

  // The `@` and `/` pickers query only while their trigger is the live token.
  const recordQuery = lockRecord ? null : parsed.recordQuery
  const templateQuery = parsed.templateQuery

  useEffect(() => {
    if (recordQuery === null) {
      setRecords([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void fetch(`/api/admin/tasks/records?q=${encodeURIComponent(recordQuery)}`, {
        headers: authHeaders,
      })
        .then(res => (res.ok ? res.json() : { records: [] }))
        .then(json => {
          if (!cancelled) setRecords((json.records ?? []) as RecordOption[])
        })
        .catch(() => {
          if (!cancelled) setRecords([])
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [recordQuery, authHeaders])

  useEffect(() => {
    if (templateQuery === null || templates.length > 0) return
    void fetch('/api/admin/task-templates', { headers: authHeaders })
      .then(res => (res.ok ? res.json() : { templates: [] }))
      .then(json => setTemplates((json.templates ?? []) as TemplateOption[]))
      .catch(() => setTemplates([]))
  }, [templateQuery, templates.length, authHeaders])

  useEffect(() => {
    if (!expanded || assignees.length > 0) return
    void fetch('/api/admin/tasks/assignees', { headers: authHeaders })
      .then(res => (res.ok ? res.json() : { assignees: [] }))
      .then(json => setAssignees((json.assignees ?? []) as AssigneeOption[]))
      .catch(() => setAssignees([]))
  }, [expanded, assignees.length, authHeaders])

  const visibleTemplates = useMemo(() => {
    if (templateQuery === null) return []
    const q = templateQuery.toLowerCase()
    return templates.filter(t => t.name.toLowerCase().includes(q)).slice(0, 6)
  }, [templates, templateQuery])

  /** Drop the trailing `@…` / `/…` token once its picker has been used. */
  const clearTrigger = useCallback(() => {
    setValue(current => current.replace(/(?:^|\s)[@/][^\s]*$/, ' ').replace(/\s+$/, ' '))
    inputRef.current?.focus()
  }, [])

  const reset = useCallback(() => {
    setValue('')
    setPriority(null)
    setRecurrence(null)
    setAssignee(null)
    setSubtasks([])
    setSubtaskDraft('')
    setSubtasksOpen(false)
    if (!lockRecord) setRecord(defaultRecord)
  }, [defaultRecord, lockRecord])

  const addSubtask = useCallback(() => {
    const text = subtaskDraft.trim()
    if (!text) return
    setSubtasks(current => [...current, text])
    setSubtaskDraft('')
  }, [subtaskDraft])

  const submit = useCallback(async () => {
    const title = parsed.title.trim()
    if (!title || saving) return
    setSaving(true)
    try {
      const created = await onCreate({
        title,
        priority: effectivePriority ?? 'normal',
        due_at: parsed.dueAt ? parsed.dueAt.toISOString() : null,
        matter_id: record?.kind === 'matter' ? record.id : null,
        lead_id: record?.kind === 'lead' ? record.id : null,
        assignee_id: assignee?.id ?? null,
        recurrence,
        checklist: subtasks.map(text => ({ text, done: false })),
      })
      if (created) reset()
    } finally {
      setSaving(false)
    }
  }, [parsed, saving, onCreate, effectivePriority, record, assignee, recurrence, subtasks, reset])

  const canSubmit = parsed.title.trim().length > 0 && !saving

  return (
    <div
      className={cn(
        'rounded-lg border bg-card transition-colors',
        expanded ? 'border-border' : 'border-transparent',
        className,
      )}
    >
      <div className="relative flex items-center gap-2 px-2">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={event => setValue(event.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              if (value) setValue('')
              else {
                setExpanded(false)
                inputRef.current?.blur()
              }
            }
          }}
          placeholder={placeholder}
          aria-label="Add a task"
          className="h-[34px] min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {!expanded && (
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground sm:inline">
            {shortcutHint}
          </kbd>
        )}
      </div>

      {/* `@` record picker */}
      {records.length > 0 && (
        <ul className="mx-2 mb-2 max-h-48 overflow-auto rounded-md border border-border bg-card">
          {records.map(option => (
            <li key={`${option.kind}:${option.id}`}>
              <button
                type="button"
                onClick={() => {
                  setRecord(option)
                  setRecords([])
                  clearTrigger()
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50"
              >
                <span className="truncate font-medium text-foreground">{option.name}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {option.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* `/` template picker */}
      {visibleTemplates.length > 0 && (
        <ul className="mx-2 mb-2 max-h-48 overflow-auto rounded-md border border-border bg-card">
          {visibleTemplates.map(template => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => {
                  onApplyTemplate?.(template.id)
                  setValue('')
                }}
                disabled={!onApplyTemplate}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 disabled:opacity-50"
              >
                <span className="truncate font-medium text-foreground">{template.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {template.items?.length ?? 0} tasks
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-border px-2 pb-2 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {record && (
              <Chip onClear={lockRecord ? undefined : () => setRecord(null)}>{record.name}</Chip>
            )}
            {parsed.dueAt && <Chip>{formatTaskDue(parsed.dueAt.toISOString())}</Chip>}
            {assignee && <Chip onClear={() => setAssignee(null)}>{assignee.name}</Chip>}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Chip dashed={!recurrence}>
                    <Repeat className="size-3" aria-hidden />
                    {recurrence ? `Every ${recurrence.every} ${recurrence.unit}` : 'Repeat'}
                  </Chip>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel className="text-xs">Repeat</DropdownMenuLabel>
                {REPEAT_PRESETS.map(preset => (
                  <DropdownMenuItem
                    key={preset.label}
                    onSelect={() => setRecurrence(preset.recurrence)}
                  >
                    {preset.label}
                  </DropdownMenuItem>
                ))}
                {recurrence && (
                  <DropdownMenuItem onSelect={() => setRecurrence(null)}>Don’t repeat</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Chip dashed={!effectivePriority}>
                    {effectivePriority ? `${effectivePriority} priority` : 'Priority'}
                  </Chip>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuLabel className="text-xs">Priority</DropdownMenuLabel>
                {TASK_PRIORITIES.map(option => (
                  <DropdownMenuItem key={option} onSelect={() => setPriority(option)}>
                    {option}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {assignees.length > 0 && !assignee && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Chip dashed>Assign</Chip>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel className="text-xs">Assign to</DropdownMenuLabel>
                  {assignees.map(option => (
                    <DropdownMenuItem key={option.id} onSelect={() => setAssignee(option)}>
                      {option.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <button
              type="button"
              onClick={() => setSubtasksOpen(open => !open)}
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={subtasksOpen}
            >
              <Chip dashed={subtasks.length === 0}>
                <ListPlus className="size-3" aria-hidden />
                {subtasks.length > 0
                  ? `${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}`
                  : 'Subtasks'}
              </Chip>
            </button>
          </div>

          {subtasksOpen && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              {subtasks.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {subtasks.map((subtask, index) => (
                    <li key={`${subtask}-${index}`} className="flex items-center gap-2 text-xs">
                      <span className="size-3 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-foreground">{subtask}</span>
                      <button
                        type="button"
                        onClick={() => setSubtasks(current => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`Remove subtask ${subtask}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={subtaskDraft}
                  onChange={event => setSubtaskDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addSubtask()
                    }
                  }}
                  placeholder="Add a subtask"
                  aria-label="Subtask title"
                  className="h-7 min-w-0 flex-1 rounded border border-border bg-card px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={!subtaskDraft.trim()}
                  onClick={addSubtask}
                >
                  Add
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Type <strong className="font-medium text-foreground">@</strong> for a record,{' '}
              <strong className="font-medium text-foreground">/</strong> for a template
            </p>
            <Button type="button" size="sm" className="h-7 text-xs" disabled={!canSubmit} onClick={() => void submit()}>
              Add task ⏎
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
