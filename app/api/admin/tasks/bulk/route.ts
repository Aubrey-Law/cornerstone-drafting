import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS, isUuid } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'

/**
 * PATCH /api/admin/tasks/bulk — reassign a selection in one write.
 *
 * The queue spans every matter, so triage is "these six are mine, that one is
 * not" — a judgement made across rows, not on any one of them. Sending six
 * PATCHes for it means six round trips, six re-renders and six chances to end
 * up half-applied, so the selection travels as a selection.
 *
 * Deliberately assignment only. It is the field the queue's own scopes
 * (mine / team / unassigned) are built on, and the one a row cannot answer by
 * itself. Status and due date already have per-row affordances that read
 * better one at a time.
 */

/** Enough for the largest sane selection, small enough to bound the URL. */
const MAX_IDS = 200

interface PatchBody {
  ids?: unknown
  assignee_id?: unknown
}

export async function PATCH(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one task' }, { status: 400 })
  }
  if (body.ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Select at most ${MAX_IDS} tasks` }, { status: 400 })
  }
  // Every id, not just the ones that parse: a selection that silently drops a
  // row would report a success the user cannot see is incomplete.
  if (!body.ids.every(id => typeof id === 'string' && isUuid(id))) {
    return NextResponse.json({ error: 'Invalid task id in selection' }, { status: 400 })
  }
  if (body.assignee_id === undefined) {
    return NextResponse.json({ error: 'assignee_id is required' }, { status: 400 })
  }
  if (body.assignee_id !== null && (typeof body.assignee_id !== 'string' || !isUuid(body.assignee_id))) {
    return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
  }

  const ids = [...new Set(body.ids as string[])]
  const assigneeId = (body.assignee_id as string | null) ?? null

  const admin = getAdminClient()

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
