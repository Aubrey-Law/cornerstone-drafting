'use client'

import { dismissesOnDelete } from '@/lib/tasks/dismiss'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  describeRecurrence,
  taskRecordHref,
  type ChecklistItem,
  type TaskPriority,
  type TaskRecurrence,
  type TaskRow,
  type TaskStatus,
} from '@/lib/tasks/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TaskCheckbox } from './TaskPrimitives'
import { useTaskActions } from './useTaskActions'

export interface TaskAssigneeOption {
  id: string
  name: string
}

interface TaskDetailSheetProps {
  task: TaskRow | null
  assignees?: TaskAssigneeOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: (task: TaskRow) => void
  onDeleted: (task: TaskRow) => void
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Archived',
}

const REPEAT_OPTIONS: Array<{ value: string; label: string; recurrence: TaskRecurrence | null }> = [
  { value: 'none', label: 'Does not repeat', recurrence: null },
  { value: 'week', label: 'Every week', recurrence: { every: 1, unit: 'week' } },
  { value: 'two-weeks', label: 'Every 2 weeks', recurrence: { every: 2, unit: 'week' } },
  { value: 'month', label: 'Every month', recurrence: { every: 1, unit: 'month' } },
]

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function recurrenceValue(recurrence: TaskRecurrence | null): string {
  if (!recurrence) return 'none'
  return REPEAT_OPTIONS.find(option =>
    option.recurrence?.every === recurrence.every && option.recurrence?.unit === recurrence.unit,
  )?.value ?? 'custom'
}

export function TaskDetailSheet({
  task,
  assignees = [],
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: TaskDetailSheetProps) {
  const actions = useTaskActions()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('open')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [dueAt, setDueAt] = useState('')
  const [assigneeId, setAssigneeId] = useState('unassigned')
  const [estimate, setEstimate] = useState('')
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null)
  const [subtasks, setSubtasks] = useState<ChecklistItem[]>([])
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (!task || !open) return
    setTitle(task.title)
    setDescription(task.description ?? '')
    setStatus(task.status)
    setPriority(task.priority)
    setDueAt(toLocalInput(task.due_at ?? task.soft_due_at))
    setAssigneeId(task.assignee_id ?? 'unassigned')
    setEstimate(task.estimate_minutes ? String(task.estimate_minutes) : '')
    setRecurrence(task.recurrence)
    setSubtasks(task.checklist.map(item => ({ ...item })))
    setSubtaskDraft('')
  }, [task, open])

  const dirty = useMemo(() => {
    if (!task) return false
    return title.trim() !== task.title
      || (description.trim() || null) !== task.description
      || status !== task.status
      || priority !== task.priority
      || fromLocalInput(dueAt) !== (task.due_at ?? task.soft_due_at)
      || (assigneeId === 'unassigned' ? null : assigneeId) !== task.assignee_id
      || (estimate ? Number(estimate) : null) !== task.estimate_minutes
      || JSON.stringify(recurrence) !== JSON.stringify(task.recurrence)
      || JSON.stringify(subtasks) !== JSON.stringify(task.checklist)
  }, [task, title, description, status, priority, dueAt, assigneeId, estimate, recurrence, subtasks])

  if (!task) return null
  const currentTask = task
  const recordHref = taskRecordHref(currentTask)

  function addSubtask() {
    const text = subtaskDraft.trim()
    if (!text) return
    setSubtasks(current => [...current, { text, done: false }])
    setSubtaskDraft('')
  }

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const updated = await actions.patch(currentTask.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_at: fromLocalInput(dueAt),
        assignee_id: assigneeId === 'unassigned' ? null : assigneeId,
        estimate_minutes: estimate ? Number(estimate) : null,
        recurrence,
        checklist: subtasks,
      })
      if (!updated) return
      onUpdated(updated)
      onOpenChange(false)
      toast.success('Task updated')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const removed = await actions.remove(currentTask)
    if (!removed) return
    setDeleteOpen(false)
    onOpenChange(false)
    onDeleted(currentTask)
    toast.success('Task deleted')
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Task details</SheetTitle>
            <SheetDescription>
              Edit the work, ownership, timing, status, and subtasks.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="space-y-1.5 text-sm">
              <span className="font-medium">Related matter</span>
              {recordHref && currentTask.record_name ? (
                <Link
                  href={recordHref}
                  className="block truncate text-sm text-primary hover:underline"
                >
                  {currentTask.record_name}
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">No related record</p>
              )}
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Title</span>
              <Input value={title} onChange={event => setTitle(event.target.value)} />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Description</span>
              <Textarea
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="Context, expected outcome, or notes"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Status</span>
                <Select value={status} onValueChange={value => setStatus(value as TaskStatus)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.filter(option => option !== 'archived').map(option => (
                      <SelectItem key={option} value={option}>{STATUS_LABEL[option]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Priority</span>
                <Select value={priority} onValueChange={value => setPriority(value as TaskPriority)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map(option => (
                      <SelectItem key={option} value={option}>
                        {option[0].toUpperCase() + option.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Due</span>
                <Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} />
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Estimate in minutes</span>
                <Input
                  type="number"
                  min="0"
                  step="5"
                  value={estimate}
                  onChange={event => setEstimate(event.target.value)}
                  placeholder="30"
                />
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Assignee</span>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assignees.map(option => (
                      <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Repeat</span>
                <Select
                  value={recurrenceValue(recurrence)}
                  onValueChange={value => {
                    const option = REPEAT_OPTIONS.find(item => item.value === value)
                    if (option) setRecurrence(option.recurrence)
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPEAT_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                    {recurrenceValue(recurrence) === 'custom' && (
                      <SelectItem value="custom">{describeRecurrence(recurrence)}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-medium">Subtasks</h3>
                <p className="text-xs text-muted-foreground">
                  Completing the final subtask completes the parent task.
                </p>
              </div>
              {subtasks.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {subtasks.map((subtask, index) => (
                    <li key={index} className="flex items-center gap-2 px-2 py-2">
                      <TaskCheckbox
                        checked={subtask.done}
                        label={subtask.text}
                        onToggle={() => setSubtasks(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, done: !item.done } : item,
                          ),
                        )}
                      />
                      <Input
                        value={subtask.text}
                        aria-label={`Subtask ${index + 1}`}
                        onChange={event => setSubtasks(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, text: event.target.value } : item,
                          ),
                        )}
                        className="h-7 border-0 px-1 shadow-none"
                      />
                      <button
                        type="button"
                        onClick={() => setSubtasks(current => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`Remove subtask ${subtask.text}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  value={subtaskDraft}
                  onChange={event => setSubtaskDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addSubtask()
                    }
                  }}
                  placeholder="Add another subtask"
                />
                <Button type="button" variant="outline" onClick={addSubtask} disabled={!subtaskDraft.trim()}>
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
            </section>
          </div>

          <SheetFooter className="border-t border-border sm:flex-row sm:items-center">
            <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} className="sm:mr-auto">
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty || !title.trim() || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              {dismissesOnDelete(currentTask.source)
                ? `“${currentTask.title}” was created automatically. It will be removed from the queue and won’t be created again for the same issue.`
                : `“${currentTask.title}” and its subtasks will be permanently removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
