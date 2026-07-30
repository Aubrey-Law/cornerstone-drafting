'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  TASK_PRIORITIES,
  describeRecurrence,
  type TaskPriority,
  type TaskRecurrence,
} from '@/lib/tasks/types'
import type { TaskTemplateItem } from '@/lib/tasks/templateItems'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'

export interface TaskTemplate {
  id: string
  name: string
  description: string | null
  items: TaskTemplateItem[]
  created_at: string
}

interface AssigneeOption {
  id: string
  name: string
}

interface DraftSubtask {
  text: string
}

interface DraftItem {
  text: string
  description: string
  offsetDays: string
  priority: TaskPriority
  assigneeId: string
  estimateMinutes: string
  recurrence: TaskRecurrence | null
  subtasks: DraftSubtask[]
  expanded: boolean
}

interface TaskTemplateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: TaskTemplate[]
  assignees?: AssigneeOption[]
  onTemplatesChange: (templates: TaskTemplate[]) => void
}

const REPEAT_OPTIONS: Array<{ value: string; label: string; recurrence: TaskRecurrence | null }> = [
  { value: 'none', label: 'Does not repeat', recurrence: null },
  { value: 'week', label: 'Every week', recurrence: { every: 1, unit: 'week' } },
  { value: 'two-weeks', label: 'Every 2 weeks', recurrence: { every: 2, unit: 'week' } },
  { value: 'month', label: 'Every month', recurrence: { every: 1, unit: 'month' } },
]

function emptyItem(): DraftItem {
  return {
    text: '',
    description: '',
    offsetDays: '',
    priority: 'normal',
    assigneeId: 'unassigned',
    estimateMinutes: '',
    recurrence: null,
    subtasks: [],
    expanded: true,
  }
}

function toDraftItem(item: TaskTemplateItem): DraftItem {
  return {
    text: item.text,
    description: item.description ?? '',
    offsetDays: item.offset_days ? String(item.offset_days) : '',
    priority: item.priority ?? 'normal',
    assigneeId: item.assignee_id ?? 'unassigned',
    estimateMinutes: item.estimate_minutes ? String(item.estimate_minutes) : '',
    recurrence: item.recurrence ?? null,
    subtasks: (item.checklist ?? []).map(subtask => ({ text: subtask.text })),
    expanded: false,
  }
}

function recurrenceValue(recurrence: TaskRecurrence | null): string {
  if (!recurrence) return 'none'
  return REPEAT_OPTIONS.find(option =>
    option.recurrence?.every === recurrence.every && option.recurrence?.unit === recurrence.unit,
  )?.value ?? 'custom'
}

function itemSummary(item: DraftItem, assignees: AssigneeOption[]): string {
  const parts: string[] = []
  if (item.offsetDays) parts.push(`due +${item.offsetDays} business day${item.offsetDays === '1' ? '' : 's'}`)
  if (item.priority !== 'normal') parts.push(`${item.priority} priority`)
  const assignee = assignees.find(option => option.id === item.assigneeId)
  if (assignee) parts.push(assignee.name)
  if (item.estimateMinutes) parts.push(`${item.estimateMinutes} min`)
  if (item.recurrence) parts.push(describeRecurrence(item.recurrence))
  if (item.subtasks.length) parts.push(`${item.subtasks.length} subtask${item.subtasks.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Default task settings'
}

/**
 * Create and edit reusable task groups. Each item carries the same reusable
 * task fields as quick capture; record-specific values are supplied when the
 * template is applied.
 */
export function TaskTemplateSheet({
  open,
  onOpenChange,
  templates,
  assignees = [],
  onTemplatesChange,
}: TaskTemplateSheetProps) {
  const token = useAccessToken()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])
  const [saving, setSaving] = useState(false)

  const headers = useMemo(
    (): HeadersInit => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    }),
    [token],
  )

  const reset = useCallback(() => {
    setEditingId(null)
    setName('')
    setDescription('')
    setItems([emptyItem()])
  }, [])

  const startCreate = useCallback(() => {
    reset()
    setEditingId('new')
  }, [reset])

  const startEdit = useCallback((template: TaskTemplate) => {
    setEditingId(template.id)
    setName(template.name)
    setDescription(template.description ?? '')
    setItems(template.items.map(toDraftItem))
  }, [])

  const filledItems = items.filter(item => item.text.trim())
  const canSave = name.trim().length > 0 && filledItems.length > 0 && !saving

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const updateSubtask = (itemIndex: number, subtaskIndex: number, text: string) => {
    setItems(current => current.map((item, index) => index === itemIndex
      ? {
          ...item,
          subtasks: item.subtasks.map((subtask, position) =>
            position === subtaskIndex ? { text } : subtask,
          ),
        }
      : item,
    ))
  }

  const payloadItems = filledItems.map(item => ({
    text: item.text.trim(),
    description: item.description.trim() || null,
    offset_days: Number(item.offsetDays) || 0,
    priority: item.priority,
    assignee_id: item.assigneeId === 'unassigned' ? null : item.assigneeId,
    estimate_minutes: Number(item.estimateMinutes) || null,
    recurrence: item.recurrence,
    checklist: item.subtasks.filter(subtask => subtask.text.trim()).map(subtask => ({
      text: subtask.text.trim(),
      done: false,
    })),
  }))

  const save = useCallback(async () => {
    if (!canSave || !editingId) return
    setSaving(true)
    try {
      const editing = editingId !== 'new'
      const res = await fetch(
        editing ? `/api/admin/task-templates/${editingId}` : '/api/admin/task-templates',
        {
          method: editing ? 'PATCH' : 'POST',
          headers,
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            items: payloadItems,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `Could not ${editing ? 'update' : 'save'} that template`)
        return
      }
      const saved = json.template as TaskTemplate
      onTemplatesChange(
        (editing ? templates.map(template => template.id === saved.id ? saved : template) : [...templates, saved])
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      toast.success(`${editing ? 'Updated' : 'Saved'} “${saved.name}”`)
      reset()
    } finally {
      setSaving(false)
    }
  }, [
    canSave,
    editingId,
    headers,
    name,
    description,
    payloadItems,
    templates,
    onTemplatesChange,
    reset,
  ])

  const archive = useCallback(async (template: TaskTemplate) => {
    const res = await fetch(`/api/admin/task-templates/${template.id}`, { method: 'DELETE', headers })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error ?? 'Could not remove that template')
      return
    }
    onTemplatesChange(templates.filter(item => item.id !== template.id))
    if (editingId === template.id) reset()
    toast.success(`Removed “${template.name}”`)
  }, [headers, templates, onTemplatesChange, editingId, reset])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Task templates</SheetTitle>
          <SheetDescription>
            Build and edit reusable task groups with ownership, timing, recurrence, and subtasks.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4">
          {!editingId && templates.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <Layers className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">No templates yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Build one for work your firm repeats.</p>
            </div>
          )}

          {!editingId && templates.map(template => (
            <div key={template.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {template.items.length} task{template.items.length === 1 ? '' : 's'}
                    {' · '}
                    {template.items.reduce((total, item) => total + (item.checklist?.length ?? 0), 0)} subtasks
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => startEdit(template)}>
                    <Pencil className="size-3.5" />
                    <span className="sr-only">Edit {template.name}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void archive(template)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Remove {template.name}</span>
                  </Button>
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {template.items.map((item, index) => (
                  <li key={index} className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden>·</span>
                    <span className="min-w-0 flex-1">{item.text}</span>
                    {item.offset_days ? <span className="shrink-0">+{item.offset_days}d</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {editingId ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{editingId === 'new' ? 'New template' : 'Edit template'}</h3>
                <Button type="button" variant="ghost" size="icon-sm" onClick={reset}>
                  <X className="size-4" />
                  <span className="sr-only">Cancel editing</span>
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium">
                  Name
                  <Input value={name} onChange={event => setName(event.target.value)} placeholder="New matter kickoff" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Description
                  <Input
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                    placeholder="What this template covers"
                  />
                </label>
              </div>

              <section className="space-y-2">
                <div>
                  <h3 className="text-sm font-medium">Tasks</h3>
                  <p className="text-xs text-muted-foreground">
                    Due offsets are business days from when the template is applied.
                  </p>
                </div>

                {items.map((item, index) => (
                  <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="flex items-center gap-2 p-2">
                      <button
                        type="button"
                        onClick={() => updateItem(index, { expanded: !item.expanded })}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={item.expanded ? `Collapse task ${index + 1}` : `Expand task ${index + 1}`}
                      >
                        {item.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                      <Input
                        value={item.text}
                        onChange={event => updateItem(index, { text: event.target.value })}
                        placeholder={`Task ${index + 1} title`}
                        aria-label={`Task ${index + 1} title`}
                        className="h-8 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => setItems(current =>
                          current.length === 1 ? [emptyItem()] : current.filter((_, itemIndex) => itemIndex !== index),
                        )}
                        aria-label={`Remove task ${index + 1}`}
                        className={cn(
                          'text-muted-foreground hover:text-destructive',
                          items.length === 1 && !item.text && 'invisible',
                        )}
                      >
                        <X className="size-4" />
                      </button>
                    </div>

                    {!item.expanded && (
                      <p className="truncate border-t border-border px-8 py-1.5 text-[11px] text-muted-foreground">
                        {itemSummary(item, assignees)}
                      </p>
                    )}

                    {item.expanded && (
                      <div className="space-y-3 border-t border-border p-3">
                        <label className="block space-y-1 text-xs font-medium">
                          Description
                          <Textarea
                            value={item.description}
                            onChange={event => updateItem(index, { description: event.target.value })}
                            placeholder="Expected outcome or context"
                            className="min-h-14"
                          />
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="space-y-1 text-xs font-medium">
                            Due after
                            <div className="flex items-center gap-1">
                              <Input
                                value={item.offsetDays}
                                onChange={event => updateItem(index, {
                                  offsetDays: event.target.value.replace(/[^0-9]/g, ''),
                                })}
                                inputMode="numeric"
                                placeholder="0"
                              />
                              <span className="shrink-0 text-xs font-normal text-muted-foreground">business days</span>
                            </div>
                          </label>

                          <label className="space-y-1 text-xs font-medium">
                            Priority
                            <Select
                              value={item.priority}
                              onValueChange={value => updateItem(index, { priority: value as TaskPriority })}
                            >
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {TASK_PRIORITIES.map(priority => (
                                  <SelectItem key={priority} value={priority}>
                                    {priority[0].toUpperCase() + priority.slice(1)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>

                          <label className="space-y-1 text-xs font-medium">
                            Estimate
                            <div className="flex items-center gap-1">
                              <Input
                                value={item.estimateMinutes}
                                onChange={event => updateItem(index, {
                                  estimateMinutes: event.target.value.replace(/[^0-9]/g, ''),
                                })}
                                inputMode="numeric"
                                placeholder="30"
                              />
                              <span className="text-xs font-normal text-muted-foreground">min</span>
                            </div>
                          </label>

                          <label className="space-y-1 text-xs font-medium">
                            Assignee
                            <Select
                              value={item.assigneeId}
                              onValueChange={value => updateItem(index, { assigneeId: value })}
                            >
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {assignees.map(assignee => (
                                  <SelectItem key={assignee.id} value={assignee.id}>{assignee.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>

                          <label className="space-y-1 text-xs font-medium">
                            Repeat
                            <Select
                              value={recurrenceValue(item.recurrence)}
                              onValueChange={value => {
                                const option = REPEAT_OPTIONS.find(repeat => repeat.value === value)
                                if (option) updateItem(index, { recurrence: option.recurrence })
                              }}
                            >
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {REPEAT_OPTIONS.map(option => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                                {recurrenceValue(item.recurrence) === 'custom' && (
                                  <SelectItem value="custom">{describeRecurrence(item.recurrence)}</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </label>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-xs font-medium">Subtasks</p>
                          {item.subtasks.map((subtask, subtaskIndex) => (
                            <div key={subtaskIndex} className="flex items-center gap-2">
                              <span className="size-3 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />
                              <Input
                                value={subtask.text}
                                onChange={event => updateSubtask(index, subtaskIndex, event.target.value)}
                                placeholder={`Subtask ${subtaskIndex + 1}`}
                                className="h-8"
                              />
                              <button
                                type="button"
                                onClick={() => updateItem(index, {
                                  subtasks: item.subtasks.filter((_, position) => position !== subtaskIndex),
                                })}
                                aria-label={`Remove subtask ${subtaskIndex + 1}`}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => updateItem(index, {
                              subtasks: [...item.subtasks, { text: '' }],
                            })}
                          >
                            <Plus className="size-3.5" />
                            Add subtask
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setItems(current => [...current, emptyItem()])}
                >
                  <Plus className="size-4" />
                  Add task
                </Button>
              </section>

              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <Button type="button" variant="outline" onClick={reset}>Cancel</Button>
                <Button type="button" disabled={!canSave} onClick={() => void save()}>
                  {saving ? 'Saving…' : editingId === 'new' ? 'Save template' : 'Save changes'}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={startCreate}>
              <Plus className="size-4" />
              New template
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
