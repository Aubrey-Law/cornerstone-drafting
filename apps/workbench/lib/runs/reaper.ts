import { statusFromSteps, type RunStep } from './steps'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

/**
 * Handing back a run whose worker died.
 *
 * A tick's own budget (`TICK_BUDGET_MS` in `./worker.ts`) is four minutes, so
 * a run genuinely still being worked is never mistaken for one that isn't —
 * ten minutes leaves room for a slow unit and a clock skew without leaving a
 * genuinely dead run sitting `running` for an hour, reading as "in progress"
 * to anyone who looks, forever.
 */
export const STALE_AFTER_MS = 10 * 60_000

/**
 * A run that kills every worker it touches must stop being handed back, or
 * one bad run becomes a permanent load on the queue instead of a person's
 * problem.
 */
export const MAX_RECLAIMS = 3

export const ABANDONED_STEP_REASON = 'The worker running this step stopped without finishing it.'

export interface ReapCandidate {
  /**
   * `workflow_runs.status`'s full range, not `RunStatus` (`./steps.ts`) —
   * that type is only what a run's *steps* can compute it as, and never
   * includes `queued`, the state a run sits in before any worker has
   * claimed it at all.
   */
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  /** Milliseconds since epoch, or null when the run has never been claimed. */
  lastTickAt: number | null
  reclaims: number
}

export type ReapDecision = { reap: false } | { reap: true; requeue: boolean }

/**
 * Whether a run should be treated as abandoned, and if so what happens next.
 *
 * Pure and total: every input this codebase's own status/heartbeat/reclaim
 * combination could produce has an answer, so a caller never has to guess
 * what an unhandled case means.
 */
export function reapDecision(candidate: ReapCandidate, now: number): ReapDecision {
  // Only a run a worker is supposed to be holding can have lost that worker.
  if (candidate.status !== 'running') return { reap: false }

  // The claim itself stamps `last_tick_at`, so null means the claim has not
  // happened yet — there is no worker to have died, and reaping it here
  // would race the claim that is about to stamp it.
  if (candidate.lastTickAt === null) return { reap: false }

  if (now - candidate.lastTickAt < STALE_AFTER_MS) return { reap: false }

  return { reap: true, requeue: candidate.reclaims < MAX_RECLAIMS }
}

/**
 * Applies `reapDecision` to every `running` run: a `running` step it left
 * behind becomes `failed` (nothing will ever finish it), and the run itself
 * is either handed back to the queue — incrementing `reclaims` — or, once it
 * has killed `MAX_RECLAIMS` workers, given up on as `partial` rather than
 * requeued forever.
 *
 * `partial` is written directly rather than through `finaliseRun`
 * (`./record.ts`): `finaliseRun` reads the run's status from its steps
 * (`statusFromSteps`), which would call a run with untouched `pending` steps
 * `running` again — exactly the state this is trying to end. Giving up here
 * is a decision about the *worker*, not a computation over what the steps
 * say happened, so it is recorded as one.
 */
export async function reapAbandonedRuns(
  client: SupabaseClient<WorkbenchDatabase>,
  now: () => number,
): Promise<{ reaped: number }> {
  const { data: rows, error } = await client
    .from('workflow_runs')
    .select('id, status, last_tick_at, reclaims')
    .eq('status', 'running')
  if (error) throw new Error(`Could not load running runs: ${error.message}`)

  const nowMs = now()
  let reaped = 0

  for (const row of (rows ?? []) as Array<{ id: unknown; status: unknown; last_tick_at: unknown; reclaims: unknown }>) {
    const lastTickAt = row.last_tick_at ? new Date(String(row.last_tick_at)).getTime() : null
    const reclaims = Number(row.reclaims ?? 0)
    const decision = reapDecision({ status: row.status as ReapCandidate['status'], lastTickAt, reclaims }, nowMs)
    if (!decision.reap) continue

    const runId = String(row.id)
    const finishedAt = new Date(nowMs).toISOString()

    const { error: stepsError } = await client
      .from('workflow_run_steps')
      .update({ status: 'failed', last_error: ABANDONED_STEP_REASON, finished_at: finishedAt })
      .eq('run_id', runId)
      .eq('status', 'running')
    if (stepsError) throw new Error(`Could not fail the abandoned run's steps: ${stepsError.message}`)

    // A worker can finish every step and die before finalising the run. There
    // is then nothing to requeue — handing it back would claim it, find no
    // pending steps, and finalise it a tick later, reporting a finished run as
    // `queued` in between. Finalise it here instead, from what its steps
    // already say.
    const { data: remaining, error: remainingError } = await client
      .from('workflow_run_steps')
      .select('unit_id, status, attempts, sequence')
      .eq('run_id', runId)
    if (remainingError) throw new Error(`Could not read the abandoned run's steps: ${remainingError.message}`)

    const steps = ((remaining ?? []) as Array<Record<string, unknown>>).map((row) => ({
      unitId: String(row.unit_id),
      status: row.status as RunStep['status'],
      attempts: Number(row.attempts ?? 0),
      sequence: Number(row.sequence ?? 0),
    }))
    const nothingLeft = steps.length > 0 && !steps.some((step) => step.status === 'pending')

    if (nothingLeft) {
      const { error: settleError } = await client
        .from('workflow_runs')
        .update({
          status: statusFromSteps(steps),
          finding_count: steps.filter((step) => step.status === 'succeeded').length,
          failed_count: steps.filter((step) => step.status === 'failed').length,
          finished_at: finishedAt,
        })
        .eq('id', runId)
      if (settleError) throw new Error(`Could not settle the abandoned run: ${settleError.message}`)
    } else if (decision.requeue) {
      const { error: requeueError } = await client
        .from('workflow_runs')
        .update({ status: 'queued', reclaims: reclaims + 1 })
        .eq('id', runId)
      if (requeueError) throw new Error(`Could not requeue the abandoned run: ${requeueError.message}`)
    } else {
      const { error: partialError } = await client
        .from('workflow_runs')
        .update({ status: 'partial', finished_at: finishedAt })
        .eq('id', runId)
      if (partialError) throw new Error(`Could not finalise the abandoned run: ${partialError.message}`)
    }

    reaped += 1
  }

  return { reaped }
}
