import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { planDateColumns, toPlanTask } from '@/lib/slaTasks/plan'
import { fetchPlanTasks } from '@/lib/slaTasks/queries'
import {
  daysBetween,
  delayDaysFor,
  shiftDownstreamTasks,
  type ShiftedTaskDates,
} from '@/lib/slaTasks/schedule'
import { PLAN_TASK_COLUMNS } from '@/lib/slaTasks/types'
import { TASK_STATUSES, type TaskRow, type TaskStatus } from '@/lib/tasks/types'

/**
 * "Skipped — not applicable" is `archived` with `skipped_at` set. It travels as
 * its own value over the wire because that is what the plan's status menu
 * offers, and because the two archived flavours mean different things: only a
 * skip counts as the phase having moved past the task.
 */
type PlanStatusInput = TaskStatus | 'skipped'

function isPlanStatus(value: unknown): value is PlanStatusInput {
  return (
    value === 'skipped' || (typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value))
  )
}

interface PatchBody {
  status?: unknown
  notes?: unknown
  /** true parks the clock on this task, false resumes it. */
  paused?: unknown
}

/** Timestamp columns that must agree with whatever status the task lands in. */
function statusStamps(status: PlanStatusInput, now: string) {
  const skipped = status === 'skipped'
  return {
    status: skipped ? 'archived' : status,
    completed_at: status === 'done' ? now : null,
    skipped_at: skipped ? now : null,
  }
}

/**
 * PATCH /api/matters/[matterId]/tasks/[taskId]
 *
 * Status changes, notes, and the clock controls. Two things move downstream due
 * dates:
 *
 *  - Resuming a paused task shifts that task and everything after it by however
 *    long it sat paused.
 *  - Completing a `pauses_clock` task after its due date shifts everything after
 *    it by the overrun. Finishing early never pulls the plan forward.
 *
 * The days moved are added to the task's own `total_paused_days`, so summing
 * that column across a matter gives the matter's total slip.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ matterId: string; taskId: string }> },
) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { matterId, taskId } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (body.status !== undefined && !isPlanStatus(body.status)) {
    return NextResponse.json({ error: 'Unknown task status' }, { status: 400 })
  }
  if (body.paused !== undefined && typeof body.paused !== 'boolean') {
    return NextResponse.json({ error: 'paused must be a boolean' }, { status: 400 })
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'notes must be a string' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: existing, error: readError } = await admin
    .from('tasks')
    .select(PLAN_TASK_COLUMNS)
    .eq('id', taskId)
    .eq('matter_id', matterId)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const task = toPlanTask(existing as unknown as TaskRow)
  const now = new Date().toISOString()
  const today = firmTodayKey()

  const update: Record<string, unknown> = {}
  if (body.notes !== undefined) {
    update.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  }

  // How many days this change slips the rest of the plan, and from where.
  let shiftDays = 0
  let shiftInclusive = false

  const completing = body.status === 'done'

  if (body.paused === true) {
    if (!task.paused_at) update.paused_at = now
    update.status = 'blocked'
    update.completed_at = null
    update.skipped_at = null
  } else if (body.paused === false) {
    update.paused_at = null
    // Resuming charges the days the task sat parked — unless this same call
    // completes it, in which case the overrun below already covers that span
    // and charging both would bill the pause twice.
    if (task.paused_at && !completing) {
      const pausedFrom = firmDateKey(task.paused_at)
      shiftDays = pausedFrom ? Math.max(0, daysBetween(pausedFrom, today)) : 0
      shiftInclusive = true
      if (!isPlanStatus(body.status)) Object.assign(update, statusStamps('in_progress', now))
    }
  }

  if (isPlanStatus(body.status)) {
    Object.assign(update, statusStamps(body.status, now))
    if (completing) {
      update.paused_at = null
      if (task.pauses_clock) {
        // Days already charged by an earlier pause/resume moved this task's own
        // due date with them, so only the overrun past it is new delay.
        shiftDays += delayDaysFor(task.due_date, now)
        shiftInclusive = false
      }
    }
  }

  if (shiftDays > 0) {
    update.total_paused_days = (task.total_paused_days || 0) + shiftDays
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ task, shifted: [] })
  }

  const { data: updated, error: updateError } = await admin
    .from('tasks')
    .update(update)
    .eq('id', taskId)
    .eq('matter_id', matterId)
    .select(PLAN_TASK_COLUMNS)
    .single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  let shifted: ShiftedTaskDates[] = []
  if (shiftDays > 0) {
    try {
      const siblings = await fetchPlanTasks(admin, matterId)
      const adopted = new Map(siblings.map(row => [row.id, row.stage_entered_at !== null]))
      shifted = shiftDownstreamTasks(siblings, task.sort_order, shiftDays, {
        inclusive: shiftInclusive,
      })
      for (const row of shifted) {
        const { error } = await admin
          .from('tasks')
          .update(planDateColumns(row, { adopted: adopted.get(row.id) === true }))
          .eq('id', row.id)
        if (error) throw error
      }
    } catch (e) {
      // The task itself is saved; report the partial outcome rather than
      // pretending the whole plan moved.
      return NextResponse.json(
        {
          task: toPlanTask(updated as unknown as TaskRow),
          shifted,
          warning: `Task saved, but downstream dates did not all shift: ${
            e instanceof Error ? e.message : 'unknown error'
          }`,
        },
        { status: 207 },
      )
    }
  }

  return NextResponse.json({
    task: toPlanTask(updated as unknown as TaskRow),
    shifted,
    shiftedDays: shiftDays,
  })
}
