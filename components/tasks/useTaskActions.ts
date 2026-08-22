'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import type { TaskRecurrence, TaskRow } from '@/lib/tasks/types'

export interface CreateTaskInput {
  title: string
  description?: string | null
  priority?: TaskRow['priority']
  matter_id?: string | null
  lead_id?: string | null
  due_at?: string | null
  assignee_id?: string | null
  estimate_minutes?: number | null
  recurrence?: TaskRecurrence | null
  checklist?: Array<{ text: string; done: boolean }>
  template_id?: string | null
  source?: TaskRow['source']

  /** When true, create a calendar block tied to this task's due date. */
  calendarAddToCalendar?: boolean
  /** Start time for the optional calendar block in ISO format. */
  calendarStartAt?: string | null
  /** Calendar block duration in minutes. */
  calendarDurationMinutes?: number | null
  /** If false, block is created as free on calendar. */
  calendarShowAsBusy?: boolean
}

/**
 * The shared task mutation surface. Every list — Tasks page, rail, record tab,
 * Today — completes and edits through these, so badges, Undo and the optimistic
 * pattern behave the same everywhere.
 */
export function useTaskActions(onChanged?: () => void) {
  const token = useAccessToken()
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  const headers = useCallback(
    (): HeadersInit => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    }),
    [token],
  )

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds(prev => {
      const next = new Set(prev)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<TaskRow | null> => {
      markPending(id, true)
      try {
        const res = await fetch(`/api/admin/tasks/${id}`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(json.error ?? 'Could not update that task')
          return null
        }
        invalidateSidebarCountsClient()
        onChanged?.()
        return json.task as TaskRow
      } finally {
        markPending(id, false)
      }
    },
    [headers, markPending, onChanged],
  )

  /** Complete a task and offer a one-click Undo back to open. */
  const complete = useCallback(
    async (task: TaskRow): Promise<TaskRow | null> => {
      const updated = await patch(task.id, { status: 'done' })
      if (!updated) return null
      toast.success(`Completed “${task.title}”`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void patch(task.id, { status: 'open' })
          },
        },
      })
      return updated
    },
    [patch],
  )

  const reopen = useCallback((task: TaskRow) => patch(task.id, { status: 'open' }), [patch])

  const toggleChecklistItem = useCallback(
    (task: TaskRow, index: number, done: boolean) =>
      patch(task.id, { checklist_index: index, done }),
    [patch],
  )

  /** Push a task's due date out by N days, keeping the time of day. */
  const snooze = useCallback(
    async (task: TaskRow, days: number, label: string) => {
      const base = task.due_at ?? task.soft_due_at ?? new Date().toISOString()
      const next = new Date(base)
      next.setDate(next.getDate() + days)
      const updated = await patch(task.id, { due_at: next.toISOString() })
      if (updated) toast.success(`“${task.title}” moved to ${label}`)
      return updated
    },
    [patch],
  )

  const create = useCallback(
    async (input: CreateTaskInput): Promise<TaskRow | null> => {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(input),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Could not add that task')
        return null
      }
      invalidateSidebarCountsClient()
      onChanged?.()
      return json.task as TaskRow
    },
    [headers, onChanged],
  )

  const remove = useCallback(
    async (task: TaskRow): Promise<boolean> => {
      markPending(task.id, true)
      try {
        const res = await fetch(`/api/admin/tasks/${task.id}`, { method: 'DELETE', headers: headers() })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          toast.error(json.error ?? 'Could not delete that task')
          return false
        }
        invalidateSidebarCountsClient()
        onChanged?.()
        return true
      } finally {
        markPending(task.id, false)
      }
    },
    [headers, markPending, onChanged],
  )

  /**
   * Reassign a selection in one write. The queue spans every matter, so triage
   * is a judgement made across rows; sending one PATCH per row would mean N
   * round trips and N chances to end up half-applied.
   */
  const assignMany = useCallback(
    async (ids: string[], assigneeId: string | null, assigneeName: string): Promise<TaskRow[] | null> => {
      if (ids.length === 0) return []
      const res = await fetch('/api/admin/tasks/bulk', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ ids, assignee_id: assigneeId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Could not reassign those tasks')
        return null
      }
      const updated = json.updated as number
      const count = `${updated} task${updated === 1 ? '' : 's'}`
      toast.success(assigneeId ? `${count} assigned to ${assigneeName}` : `${count} unassigned`)
      // A selection can go stale while it is held — another tab completes a
      // task, a sweep archives it — so say so rather than let the count read
      // as a silent partial success.
      const missing = (json.missing ?? []) as string[]
      if (missing.length > 0) {
        toast.warning(`${missing.length} of them no longer exist and were skipped`)
      }
      invalidateSidebarCountsClient()
      onChanged?.()
      return (json.tasks ?? []) as TaskRow[]
    },
    [headers, onChanged],
  )

  const applyTemplate = useCallback(
    async (templateId: string, record: { matter_id?: string | null; lead_id?: string | null }) => {
      const res = await fetch('/api/admin/task-templates/apply', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ template_id: templateId, ...record }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Could not apply that template')
        return null
      }
      const tasks = (json.tasks ?? []) as TaskRow[]
      toast.success(`Added ${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
      invalidateSidebarCountsClient()
      onChanged?.()
      return tasks
    },
    [headers, onChanged],
  )

  return {
    pendingIds,
    isPending: (id: string) => pendingIds.has(id),
    patch,
    complete,
    reopen,
    toggleChecklistItem,
    snooze,
    assignMany,
    create,
    remove,
    applyTemplate,
  }
}
