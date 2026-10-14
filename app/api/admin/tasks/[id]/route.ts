import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, isUuid } from '@/lib/queries/tasks'
import { actorFrom, createNextOccurrence, logTaskActivity } from '@/lib/tasks/server'
import { parseRecurrence } from '@/lib/tasks/recurrence'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ChecklistItem,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '@/lib/tasks/types'
import { taskStatusStamps } from '@/lib/tasks/statusMutation'
import { removeTasks } from '@/lib/tasks/dismiss'
import { invalidateWorkGraphCache } from '@/lib/work/requestCache'

type Params = { params: Promise<{ id: string }> }

interface PatchBody {
  status?: unknown
  title?: unknown
  description?: unknown
  priority?: unknown
  due_at?: unknown
  assignee_id?: unknown
  estimate_minutes?: unknown
  remind_at?: unknown
  recurrence?: unknown
  checklist?: unknown
  /** Toggle one checklist item: index + done. */
  checklist_index?: unknown
  done?: unknown
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The columns that must agree with whatever status a task lands in.
 *
 * `skipped_at` and `closeout_reason` are cleared on every hand-set status for
 * the reason `app/api/matters/[matterId]/tasks/[taskId]/route.ts` clears them:
 * a row still carrying the closeout sweep's marker is one that
 * `restoreTasksForReopenedRecord` will drag back to `open` the next time its
 * record is reopened, undoing the completion the user just recorded.
 */
function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [{ text: item.trim(), done: false }] : []
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    return typeof raw.text === 'string' && raw.text.trim()
      ? [{ text: raw.text.trim(), done: raw.done === true }]
      : []
  })
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const admin = getAdminClient()

  const { data: existingRow, error: loadError } = await admin
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!existingRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const existing = existingRow as unknown as TaskRow

  const patch: Record<string, unknown> = {}
  let completing = false

  // ── Checklist item toggle ────────────────────────────────────────────────
  if (typeof body.checklist_index === 'number') {
    if (typeof body.done !== 'boolean') {
      return NextResponse.json({ error: 'done is required with checklist_index' }, { status: 400 })
    }
    const checklist = [...((existing.checklist ?? []) as ChecklistItem[])]
    if (body.checklist_index < 0 || body.checklist_index >= checklist.length) {
      return NextResponse.json({ error: 'Invalid checklist index' }, { status: 400 })
    }
    checklist[body.checklist_index] = { ...checklist[body.checklist_index], done: body.done }
    patch.checklist = checklist

    // Clearing the last item finishes the task; unchecking one reopens it.
    const allDone = checklist.length > 0 && checklist.every(item => item.done)
    if (allDone && existing.status !== 'done') {
      // Stamped like any other completion: "Done today" is read off
      // `completed_at`, so a task finished by its last checkbox would otherwise
      // leave the queue without ever landing anywhere the user can see it.
      Object.assign(patch, taskStatusStamps('done', existing, auth.userId))
      completing = true
    } else if (!allDone && existing.status === 'done') {
      Object.assign(patch, taskStatusStamps('open', existing, auth.userId))
    }
  }

  // ── Status ───────────────────────────────────────────────────────────────
  if (typeof body.status === 'string') {
    if (!TASK_STATUSES.includes(body.status as TaskStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const status = body.status as TaskStatus
    Object.assign(patch, taskStatusStamps(status, existing, auth.userId))
    if (status === 'done') {
      if (existing.status !== 'done') completing = true
      // Completing a checklist task closes out its remaining items.
      patch.checklist = ((existing.checklist ?? []) as ChecklistItem[]).map(item => ({ ...item, done: true }))
    } else {
      completing = false
    }
  }

  // ── Field edits ──────────────────────────────────────────────────────────
  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'A task needs a title' }, { status: 400 })
    patch.title = title
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null
  }
  if (body.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(body.priority as TaskPriority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    patch.priority = body.priority
  }
  if (body.due_at !== undefined) patch.due_at = optionalTimestamp(body.due_at)
  if (body.remind_at !== undefined) patch.remind_at = optionalTimestamp(body.remind_at)
  if (body.assignee_id !== undefined) {
    patch.assignee_id = typeof body.assignee_id === 'string' && isUuid(body.assignee_id)
      ? body.assignee_id
      : null
  }
  if (body.estimate_minutes !== undefined) {
    const estimate = Number(body.estimate_minutes)
    patch.estimate_minutes = Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate) : null
  }
  if (body.recurrence !== undefined) {
    patch.recurrence = body.recurrence === null ? null : parseRecurrence(body.recurrence)
  }
  if (body.checklist !== undefined) {
    const checklist = normalizeChecklist(body.checklist)
    // A request that also names a status has said what it wants outright — the
    // detail sheet sends both on every save — so the checklist must not talk it
    // back out of it. Without this, saving any edit to a finished task reopened
    // it, because a task with no subtasks reads as "not all done".
    const statusRequested = typeof body.status === 'string'
    patch.checklist = statusRequested && body.status === 'done'
      ? checklist.map(item => ({ ...item, done: true }))
      : checklist
    patch.task_type = checklist.length > 0 ? 'checklist' : 'single'

    if (!statusRequested && checklist.length > 0) {
      const allDone = checklist.every(item => item.done)
      if (allDone && existing.status !== 'done') {
        Object.assign(patch, taskStatusStamps('done', existing, auth.userId))
        completing = true
      } else if (!allDone && existing.status === 'done') {
        Object.assign(patch, taskStatusStamps('open', existing, auth.userId))
        completing = false
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select(TASK_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateWorkGraphCache()
  const task = data as unknown as TaskRow

  let nextTask: TaskRow | null = null
  if (completing) {
    await logTaskActivity(admin, task, 'task_completed', actorFrom(auth.user))
    nextTask = await createNextOccurrence(admin, task)
  }

  return NextResponse.json({ task, nextTask })
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })

  const admin = getAdminClient()
  const { data: row, error: loadError } = await admin
    .from('tasks')
    .select('id, source')
    .eq('id', id)
    .maybeSingle()
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  // Already gone is the outcome the caller asked for.
  if (!row) return NextResponse.json({ ok: true, dismissed: false })

  // A generated task is dismissed rather than deleted, or its sweep writes it
  // straight back — see lib/tasks/dismiss.ts.
  const { dismissed, error } = await removeTasks(admin, [row as Pick<TaskRow, 'id' | 'source'>])
  if (error) return NextResponse.json({ error }, { status: 500 })
  invalidateWorkGraphCache()

  return NextResponse.json({ ok: true, dismissed: dismissed.length > 0 })
}
