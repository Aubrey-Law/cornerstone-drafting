import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { toPlanTasks } from '@/lib/slaTasks/plan'
import { PLAN_TASK_COLUMNS, SLA_PHASES } from '@/lib/slaTasks/types'
import type { TaskRow } from '@/lib/tasks/types'

/**
 * PATCH /api/matters/[matterId]/tasks/phase — mark a whole stage not applicable.
 *
 * A will-only matter does not need the Design stage, and a matter that never
 * goes to revision does not need Revision. Skipping those a task at a time is
 * ten clicks to say one thing, so the plan says it once per stage instead.
 *
 * Same semantics as the per-task skip in ../[taskId]: `archived` with
 * `skipped_at` set. It is deliberately not a new state — a stage is not
 * applicable exactly when its tasks are, and giving the stage its own flag
 * would leave two things to keep in agreement.
 */

/** The plan's own bucket for hand-added work that names no stage. */
const UNPHASED = 'unphased'

/** Statuses that represent work still outstanding. */
const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

interface PatchBody {
  phase?: unknown
  status?: unknown
}

function isPhase(value: unknown): value is string {
  return (
    value === UNPHASED ||
    (typeof value === 'string' && (SLA_PHASES as readonly string[]).includes(value))
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Match the stage exactly as the board groups it. The unphased card holds both
 * a null phase and any value the vocabulary no longer knows, so filtering on
 * `is null` alone would leave rows visible on the card but untouched by the
 * action taken on it.
 */
function inPhase(query: any, phase: string) {
  if (phase !== UNPHASED) return query.eq('phase', phase)
  return query.or(`phase.is.null,phase.not.in.(${SLA_PHASES.join(',')})`)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ matterId: string }> },
) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { matterId } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  if (!isPhase(body.phase)) {
    return NextResponse.json({ error: 'Unknown stage' }, { status: 400 })
  }
  if (body.status !== 'skipped' && body.status !== 'open') {
    return NextResponse.json({ error: 'status must be skipped or open' }, { status: 400 })
  }

  const admin = getAdminClient()
  const now = new Date().toISOString()
  const skipping = body.status === 'skipped'

  let query = admin
    .from('tasks')
    .update(
      skipping
        ? { status: 'archived', skipped_at: now, completed_at: null, closeout_reason: null }
        : { status: 'open', skipped_at: null, completed_at: null, closeout_reason: null },
    )
    .eq('matter_id', matterId)

  if (skipping) {
    // Completed work is the record of what the firm did; a stage turning out
    // not to apply does not unmake it.
    query = query.in('status', OPEN_STATUSES)
  } else {
    query = query
      .eq('status', 'archived')
      .not('skipped_at', 'is', null)
      // Rows the closeout sweep archived belong to the matter's status, not to
      // this stage. Reopening the matter is what brings those back.
      .is('closeout_reason', null)
  }

  const { data, error } = await inPhase(query, body.phase).select(PLAN_TASK_COLUMNS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tasks = toPlanTasks((data ?? []) as unknown as TaskRow[])
  return NextResponse.json({ phase: body.phase, status: body.status, updated: tasks.length, tasks })
}
