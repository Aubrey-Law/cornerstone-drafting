import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { actionableFindings, runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'
import { recordStep, finaliseRun, type UnitOutcome } from './record'
import { unitsToRetry, type RunStep, type StepStatus } from './steps'
import { saveFindings as saveFieldAuditFindings } from '@/lib/fieldAudit/persist'
import { emitTasks } from '@/lib/fieldAudit/tasks'
import { saveFindings as saveReviewFindings } from '@/lib/review/persist'
import { loadRunContext, unitsFor, type ReviewBody } from './context'

/**
 * Retrying the units a run lost — the whole reason this slice exists.
 *
 * A run that lost one check of forty used to have one remedy: run all forty
 * again, re-paying for thirty-nine successful model calls to fix one
 * failure. `unitsToRetry` (`./steps.ts`) already knows which units those
 * are; this is what actually re-runs only them, for either kind of run.
 *
 * Both kinds share everything here except two things, which is exactly what
 * the design calls out: how the retried units are picked out of the prompt
 * body (`body.checks` vs `body.rules`), and how the pinned evidence is
 * rebuilt (`resolved_inputs` vs the text layer read back by `text_layer_id`).
 * `loadRunContext` (`./context.ts`) is what rebuilds both — the tick needs
 * exactly the same thing, and two copies of that rebuild would drift.
 * Dispatch happens once, on `context.kind`, at those two points; everything
 * else — deleting a superseded finding, recording steps, finalising the run —
 * runs the same way for both.
 */

export interface RetryDependencies {
  callModel: ModelCaller
  model?: string
  userId?: string | null
}

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
 * Retries the failed units of one run, and only them.
 *
 * 1. Load the run's context — its own `prompt_version_id` (never the
 *    currently published one; a retry finishes the run it belongs to, and
 *    silently upgrading it to a newer wording would make the run's findings
 *    answers to two different questions) and the pinned evidence for its
 *    kind. See `loadRunContext` (`./context.ts`).
 * 2. Load the run's steps. `unitsToRetry` gives the failed unit ids, in the
 *    order they originally ran. Nothing failed → return unchanged, without
 *    opening a single connection to the model.
 * 3. Filter the body's units down to the retry set with `unitsFor`, in the
 *    body's own order, and run the matching engine over just that subset
 *    against the evidence already loaded. Neither re-reads its live source:
 *    a sheet or document edited since the run belongs to a fresh run, not
 *    this one.
 * 4. For each retried unit, delete the finding its earlier attempt left
 *    (Task 8 — see the comment at the delete below) before the new one is
 *    stored, then store what came back and finalise the run from its steps
 *    as they now stand.
 * 5. For a field audit only, emit tasks for the retried units — the same
 *    `emitTasks` a first run calls, but scoped to just the units this retry
 *    touched (`unitIds`), so a check that failed, was retried, and now
 *    reports a verified actionable finding gets the task a first run would
 *    have given it, and so that this run's own tasks for the units that
 *    *didn't* fail are left alone. See `tasksToSupersedeForUnits` in
 *    `lib/fieldAudit/tasks.ts` for why that is a different question from the
 *    one a first run asks. A review retry creates no tasks — reviews never
 *    have.
 */
export async function retryFailedSteps(
  client: SupabaseClient<WorkbenchDatabase>,
  runId: string,
  deps: RetryDependencies,
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

  // Set only on the field-audit branch, and read after `finaliseRun` below —
  // a retried unit's task has to reflect the run's *final* recorded outcome,
  // the same way a first run's does.
  let fieldAuditTasks: { checks: FieldAuditCheck[]; findings: FieldAuditFinding[] } | null = null

  // A step's `attempts` is what it already recorded; retry runs it once
  // more, so the count written back is one higher than what is already
  // there. The engine only ever tells us whether this attempt succeeded —
  // it knows nothing about a database — so the running total is kept here.
  const onUnitSettled = async (unitId: string, outcome: UnitOutcome): Promise<void> => {
    const original = stepByUnit.get(unitId)
    const sequence = original ? Number(original.sequence ?? 0) : 0
    const attempts = (original ? Number(original.attempts ?? 0) : 0) + 1
    await recordStep(client, runId, unitId, sequence, outcome, attempts)
  }

  if (context.kind === 'field_audit') {
    const { prompt, values, run } = context
    const checks = unitsFor(prompt.body as FieldAuditBody, retryUnitIds)
    if (checks.length === 0) {
      return {
        ok: false,
        message: `None of the failed units (${retryUnitIds.join(', ')}) are still in "${prompt.title}" version ${prompt.versionNumber}.`,
      }
    }

    const result = await runFieldAudit(
      {
        promptSlug: prompt.slug,
        promptVersion: prompt.versionNumber,
        values,
        matterId: String(run.matter_id),
        userId: deps.userId ?? null,
      },
      { ...(prompt.body as FieldAuditBody), checks },
      { callModel: deps.callModel, model: deps.model ?? run.model ?? undefined, onUnitSettled },
    )

    const deleted = await deleteSupersededFindings(client, retryUnitIds, stepByUnit)
    if (!deleted.ok) return deleted

    const saved = await saveFieldAuditFindings(client, runId, result)
    if (!saved.ok) return { ok: false, message: saved.message }

    // Findings for the retried checks only — same restriction `emitTasks`
    // applies again itself via `unitIds`, kept here too so the check list
    // handed to it matches the units it is being asked to emit for.
    fieldAuditTasks = { checks, findings: actionableFindings(result) }
  } else {
    const { prompt, layer, run } = context
    const rules = unitsFor(prompt.body as ReviewBody, retryUnitIds)
    if (rules.length === 0) {
      return {
        ok: false,
        message: `None of the failed units (${retryUnitIds.join(', ')}) are still in "${prompt.title}" version ${prompt.versionNumber}.`,
      }
    }

    const result = await runReviewPlaybook(
      layer,
      { slug: prompt.slug, title: prompt.title, version: prompt.versionNumber, rules },
      { callModel: deps.callModel, model: deps.model ?? run.model ?? undefined, userId: deps.userId ?? null, onUnitSettled },
    )

    const deleted = await deleteSupersededFindings(client, retryUnitIds, stepByUnit)
    if (!deleted.ok) return deleted

    const saved = await saveReviewFindings(client, {
      runId,
      documentVersionId: String(run.document_version_id),
      textLayerId: String(run.text_layer_id),
      result,
    })
    if (!saved.ok) return { ok: false, message: saved.message }
  }

  // Read the steps back rather than merging the retried outcomes into the
  // ones already loaded by hand: `finaliseRun` should reflect exactly what
  // was written, and re-reading is what guarantees that.
  const { data: finalStepRows, error: finalStepsError } = await client
    .from('workflow_run_steps')
    .select('unit_id, status, sequence, attempts')
    .eq('run_id', runId)
  if (finalStepsError) return { ok: false, message: `Could not reload the run's steps: ${finalStepsError.message}` }
  const finalSteps = ((finalStepRows ?? []) as StepRow[]).map(toRunStep)
  await finaliseRun(client, runId, finalSteps)

  // A field audit's retried units get the task a first run would have given
  // them; a review never emits tasks at all, retried or not.
  if (fieldAuditTasks) {
    await emitTasks(client, {
      matterId: String(context.run.matter_id),
      runId,
      checks: fieldAuditTasks.checks,
      findings: fieldAuditTasks.findings,
      unitIds: retryUnitIds,
    })
  }

  return { ok: true, retried: retryUnitIds.length }
}

/**
 * The destructive part of retry, named.
 *
 * `workflow_findings` has `unique (run_id, rule_number)`, so a retried
 * unit's new finding collides with the one its earlier attempt left. This
 * deletes that superseded finding by the `finding_id` the step already
 * holds — not by matching `(run_id, rule_number)`, which the step never
 * claimed and which could delete a row a *different* attempt produced under
 * the same number by coincidence of timing. Only a unit actually being
 * retried is touched; a step with no `finding_id` (its earlier attempt never
 * produced one) is left alone.
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
