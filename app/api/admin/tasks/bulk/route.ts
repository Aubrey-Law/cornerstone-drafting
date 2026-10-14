import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, isUuid } from '@/lib/queries/tasks'
import { snoozedDueAt } from '@/lib/tasks/snooze'
import { removeTasks } from '@/lib/tasks/dismiss'
import type { TaskRow } from '@/lib/tasks/types'
import { invalidateWorkGraphCache } from '@/lib/work/requestCache'

/**
 * /api/admin/tasks/bulk — act on a selection in one request.
 *
 * The queue spans every matter, so triage is "these six are mine, that one is
 * not" — a judgement made across rows, not on any one of them. Sending six
 * PATCHes for it means six round trips, six re-renders and six chances to end
 * up half-applied, so the selection travels as a selection.
 *
 * PATCH does exactly one of: reassign (`assignee_id`) or snooze
 * (`snooze_days`). DELETE removes the selection.
 */

/** Enough for the largest sane selection, small enough to bound the URL. */
const MAX_IDS = 200

/** A snooze is a push, not a reschedule; a year out is already a stretch. */
const MAX_SNOOZE_DAYS = 365

interface BulkBody {
  ids?: unknown
  assignee_id?: unknown
  snooze_days?: unknown
}

type Admin = ReturnType<typeof getAdminClient>

/** Validates the selection. Returns the deduplicated ids or an error response. */
function parseIds(body: BulkBody): { ids: string[] } | { err: NextResponse } {
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return { err: NextResponse.json({ error: 'Select at least one task' }, { status: 400 }) }
  }
  if (body.ids.length > MAX_IDS) {
    return { err: NextResponse.json({ error: `Select at most ${MAX_IDS} tasks` }, { status: 400 }) }
  }
  // Every id, not just the ones that parse: a selection that silently drops a
  // row would report a success the user cannot see is incomplete.
  if (!body.ids.every(id => typeof id === 'string' && isUuid(id))) {
    return { err: NextResponse.json({ error: 'Invalid task id in selection' }, { status: 400 }) }
  }
  return { ids: [...new Set(body.ids as string[])] }
}

export async function PATCH(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as BulkBody

  const parsed = parseIds(body)
  if ('err' in parsed) return parsed.err
  const { ids } = parsed

  const assigning = body.assignee_id !== undefined
  const snoozing = body.snooze_days !== undefined
  if (assigning === snoozing) {
    // Neither is malformed; both is ambiguous about what a partial failure
    // would mean. One action per request.
    return NextResponse.json(
      { error: assigning ? 'Send assignee_id or snooze_days, not both' : 'assignee_id is required' },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  return snoozing
    ? snoozeSelection(admin, ids, body.snooze_days, userId)
    : assignSelection(admin, ids, body.assignee_id, userId)
}

async function assignSelection(admin: Admin, ids: string[], rawAssignee: unknown, userId: string | null | undefined) {
  if (rawAssignee !== null && (typeof rawAssignee !== 'string' || !isUuid(rawAssignee))) {
    return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
  }
  const assigneeId = (rawAssignee as string | null) ?? null

  // Unassigning needs no check; assigning does. Writing an arbitrary uuid into
  // assignee_id would put a task in a queue belonging to nobody.
  if (assigneeId) {
    const { data: assignee, error: assigneeError } = await admin
      .from('users')
      .select('id, role')
      .eq('id', assigneeId)
      .maybeSingle()
    if (assigneeError) {
      return NextResponse.json({ error: assigneeError.message }, { status: 500 })
    }
    if (!assignee || !['attorney', 'admin', 'va', 'staff'].includes(assignee.role as string)) {
      return NextResponse.json({ error: 'That person cannot be assigned tasks' }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from('tasks')
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select(TASK_COLUMNS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tasks = (data ?? []) as unknown as TaskRow[]
  invalidateWorkGraphCache()
  return NextResponse.json({
    tasks,
    updated: tasks.length,
    // The ids that matched nothing. A selection can go stale while it is held —
    // another tab completes a task, a sweep archives it — and saying so beats
    // reporting a count the user has to reconcile themselves.
    missing: ids.filter(id => !tasks.some(task => task.id === id)),
    assignee_id: assigneeId,
    actor_id: userId ?? null,
  })
}

async function snoozeSelection(admin: Admin, ids: string[], rawDays: unknown, userId: string | null | undefined) {
  if (typeof rawDays !== 'number' || !Number.isInteger(rawDays) || rawDays < 1 || rawDays > MAX_SNOOZE_DAYS) {
    return NextResponse.json({ error: `snooze_days must be a whole number from 1 to ${MAX_SNOOZE_DAYS}` }, { status: 400 })
  }

  const { data: rows, error: loadError } = await admin
    .from('tasks')
    .select('id, status, due_at, soft_due_at')
    .in('id', ids)
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })

  const existing = (rows ?? []) as Array<Pick<TaskRow, 'id' | 'status' | 'due_at' | 'soft_due_at'>>
  // A finished task has no due date left to push; the row menu does not offer
  // snooze on one either. Reported, not silently counted as snoozed.
  const skipped = existing.filter(row => row.status === 'done').map(row => row.id)
  const targets = existing.filter(row => row.status !== 'done')

  // Each row moves from its own date, exactly as the row menu would move it,
  // so the dates differ per row and cannot share one UPDATE.
  const now = new Date()
  const updatedAt = now.toISOString()
  const results = await Promise.all(
    targets.map(row =>
      admin
        .from('tasks')
        .update({ due_at: snoozedDueAt(row, rawDays, now), updated_at: updatedAt })
        .eq('id', row.id)
        .select(TASK_COLUMNS)
        .maybeSingle(),
    ),
  )

  const tasks: TaskRow[] = []
  const failed: string[] = []
  results.forEach((result, index) => {
    if (result.error || !result.data) failed.push(targets[index].id)
    else tasks.push(result.data as unknown as TaskRow)
  })

  if (tasks.length === 0 && failed.length > 0) {
    const message = results.find(result => result.error)?.error?.message ?? 'Could not snooze those tasks'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  invalidateWorkGraphCache()
  return NextResponse.json({
    tasks,
    updated: tasks.length,
    missing: ids.filter(id => !existing.some(row => row.id === id)),
    skipped,
    failed,
    snooze_days: rawDays,
    actor_id: userId ?? null,
  })
}

export async function DELETE(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as BulkBody
  const parsed = parseIds(body)
  if ('err' in parsed) return parsed.err
  const { ids } = parsed

  const admin = getAdminClient()

  const { data: rows, error: loadError } = await admin
    .from('tasks')
    .select('id, source')
    .in('id', ids)
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })

  const existing = (rows ?? []) as Array<Pick<TaskRow, 'id' | 'source'>>
  // Stage-engine tasks belong to the matter's stage, not to whoever is
  // triaging: the engine upserts them back on the next stage fire, and no
  // per-row surface offers to delete one. They are left in place and named.
  const protectedIds = existing.filter(row => row.source === 'stage').map(row => row.id)
  const deletable = existing.filter(row => row.source !== 'stage')

  // Generated tasks are dismissed rather than deleted, or their sweep writes
  // them straight back — see lib/tasks/dismiss.ts. Both leave the queue.
  const { removed: deleted, dismissed, error } = await removeTasks(admin, deletable)
  if (error) return NextResponse.json({ error }, { status: 500 })
  invalidateWorkGraphCache()

  return NextResponse.json({
    deleted,
    deleted_count: deleted.length,
    dismissed,
    missing: ids.filter(id => !existing.some(row => row.id === id)),
    protected: protectedIds,
    actor_id: userId ?? null,
  })
}
