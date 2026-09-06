import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { pokeTick } from './enqueue'
import { unitsToRetry, type RunStep, type StepStatus } from './steps'
import { loadRunContext } from './context'

/**
 * Retrying the units a run lost — the whole reason this slice exists.
 *
 * A run that lost one check of forty used to have one remedy: run all forty
 * again, re-paying for thirty-nine successful model calls to fix one
 * failure. `unitsToRetry` (`./steps.ts`) already knows which units those
 * are; this is what marks only them for another attempt.
 *
 * Used to run the matching engine over just that subset itself, in the same
 * request. It no longer does: a retry queues its run the same way a first
 * run does, and a tick works it — one code path, not two behaviours, so a
 * retry of twenty units is no more obligated to finish in one request than a
 * first run of twenty is. See `apps/workbench/app/api/cron/tick/route.ts`,
 * which claims the run, works its `pending` steps (this call's whole point
 * is to leave some), and — once nothing is left `pending` — finalises the
 * run and, for a field audit, emits its tasks. A retried run's tasks are
 * therefore created there too, never here: this call has no findings of its
 * own to make a task from.
 *
 * `loadRunContext` is still called, not to replay anything (there is no
 * engine call left to hand its prompt body or pinned evidence to), but to
 * fail fast the same way it always has: a run whose prompt version no longer
 * exists, or whose stored text layer is gone, should say so now rather than
 * queue a run the tick can only fail on claiming.
 */

export type RetryResult = { ok: true; retried: number } | { ok: false; message: string }

type StepRow = {
  unit_id: unknown
  status: unknown
  sequence: unknown
  attempts: unknown
  finding_id?: unknown
}

function toRunStep(row: StepRow): RunStep {
  return {
    unitId: String(row.unit_id),
    status: row.status as StepStatus,
    attempts: Number(row.attempts ?? 0),
    sequence: Number(row.sequence ?? 0),
  }
}

/**
 * Marks the failed units of one run `pending` again, and only them, then
 * queues the run so a tick works them.
 *
 * 1. Load the run's context, only to confirm it still resolves — see the
 *    header comment.
 * 2. Load the run's steps. `unitsToRetry` gives the failed unit ids, in the
 *    order they originally ran. Nothing failed → return unchanged, without
 *    touching a single row.
 * 3. Delete the finding each retried unit's earlier attempt left (Task 8 —
 *    see the comment at the delete below), then reset that unit's step to
 *    `pending`: its `last_error` and `finding_id` are cleared, but its
 *    `attempts` is left exactly as it was — the worker's next settle writes
 *    one more than what is already there, same as it always has. A step
 *    that did not fail is not touched at all: this is what proves a retry
 *    never re-pays for successful work.
 * 4. Set the run back to `queued` and poke the tick.
 */
export async function retryFailedSteps(
  client: SupabaseClient<WorkbenchDatabase>,
  runId: string,
): Promise<RetryResult> {
  const context = await loadRunContext(client, runId)
  if (!context.ok) return context

  const { data: stepRows, error: stepsError } = await client
    .from('workflow_run_steps')
    .select('unit_id, status, sequence, attempts, finding_id')
    .eq('run_id', runId)
  if (stepsError) return { ok: false, message: `Could not load the run's steps: ${stepsError.message}` }

  const steps = ((stepRows ?? []) as StepRow[]).map(toRunStep)
  const retryUnitIds = unitsToRetry(steps)
  if (retryUnitIds.length === 0) return { ok: true, retried: 0 }

  const stepByUnit = new Map<string, StepRow>(((stepRows ?? []) as StepRow[]).map((row) => [String(row.unit_id), row]))

  const deleted = await deleteSupersededFindings(client, retryUnitIds, stepByUnit)
  if (!deleted.ok) return deleted

  for (const unitId of retryUnitIds) {
    const { error } = await client
      .from('workflow_run_steps')
      .update({ status: 'pending', last_error: null, finding_id: null, started_at: null, finished_at: null })
      .eq('run_id', runId)
      .eq('unit_id', unitId)
    if (error) return { ok: false, message: `Could not reopen unit ${unitId}: ${error.message}` }
  }

  const { error: runError } = await client.from('workflow_runs').update({ status: 'queued' }).eq('id', runId)
  if (runError) return { ok: false, message: `Could not requeue the run: ${runError.message}` }

  await pokeTick()

  return { ok: true, retried: retryUnitIds.length }
}

/**
 * The destructive part of retry, named.
 *
 * `workflow_findings` has `unique (run_id, rule_number)`, so a retried
 * unit's new finding would collide with the one its earlier attempt left,
 * once the tick writes it. This deletes that superseded finding by the
 * `finding_id` the step already holds — not by matching `(run_id,
 * rule_number)`, which the step never claimed and which could delete a row a
 * *different* attempt produced under the same number by coincidence of
 * timing. Only a unit actually being retried is touched; a step with no
 * `finding_id` (its earlier attempt never produced one) is left alone.
 *
 * `workflow_citations` and `workflow_field_references` both declare
 * `finding_id ... references public.workflow_findings(id) on delete cascade`
 * — `workflow_citations` in `supabase/migrations/20261027000000_workflow_runs_and_findings.sql`
 * (added by `alter table ... add column if not exists finding_id ...`), and
 * `workflow_field_references` in `supabase/migrations/20261028000000_prompt_objects.sql`.
 * Confirmed by reading both migrations rather than assumed: a superseded
 * finding's evidence goes with it, and nothing is left orphaned.
 */
async function deleteSupersededFindings(
  client: SupabaseClient<WorkbenchDatabase>,
  retryUnitIds: string[],
  stepByUnit: Map<string, StepRow>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const unitId of retryUnitIds) {
    const findingId = stepByUnit.get(unitId)?.finding_id
    if (!findingId) continue
    const { error } = await client.from('workflow_findings').delete().eq('id', String(findingId))
    if (error) return { ok: false, message: `Could not delete the superseded finding for unit ${unitId}: ${error.message}` }
  }
  return { ok: true }
}
