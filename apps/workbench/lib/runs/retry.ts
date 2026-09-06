import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { loadPromptVersionById } from '@/lib/prompts/repository'
import { actionableFindings, runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'
import { recordStep, finaliseRun, type UnitOutcome } from './record'
import { unitsToRetry, type RunStep, type StepStatus } from './steps'
import { saveFindings as saveFieldAuditFindings } from '@/lib/fieldAudit/persist'
import { emitTasks } from '@/lib/fieldAudit/tasks'
import { saveFindings as saveReviewFindings } from '@/lib/review/persist'
import { toLayer } from '@/lib/review/history'

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
 * Dispatch happens once, on `runRow.kind`, at those two points; everything
 * else — loading the pinned prompt version, deleting a superseded finding,
 * recording steps, finalising the run — runs the same way for both.
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
 * 1. Load the run and its steps. `unitsToRetry` gives the failed unit ids,
 *    in the order they originally ran. Nothing failed → return unchanged,
 *    without opening a single connection to the model.
 * 2. Load **the run's own `prompt_version_id`** — never the currently
 *    published version. A retry finishes the run it belongs to; silently
 *    upgrading it to a newer wording would make the run's findings answers
 *    to two different questions. See `loadPromptVersionById`.
 * 3. Filter the body's units down to the retry set, and rebuild the pinned
 *    evidence for the run's kind — `resolved_inputs` for a field audit, the
 *    stored text layer for a review. Neither re-reads its live source: a
 *    sheet or document edited since the run belongs to a fresh run, not
 *    this one. Run the matching engine over just that subset.
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
  const { data: runRow, error: runError } = await client
    .from('workflow_runs')
    .select('id, kind, prompt_version_id, matter_id, resolved_inputs, text_layer_id, document_version_id, model')
    .eq('id', runId)
    .maybeSingle()
  if (runError) return { ok: false, message: `Could not load the run: ${runError.message}` }
  if (!runRow) return { ok: false, message: `No run ${runId}.` }
  if (!runRow.prompt_version_id) {
    return { ok: false, message: `Run ${runId} has no prompt version recorded, so there is nothing to retry against.` }
  }

  const { data: stepRows, error: stepsError } = await client
    .from('workflow_run_steps')
    .select('unit_id, status, sequence, attempts, finding_id')
    .eq('run_id', runId)
  if (stepsError) return { ok: false, message: `Could not load the run's steps: ${stepsError.message}` }

  const steps = ((stepRows ?? []) as StepRow[]).map(toRunStep)
  const retryUnitIds = unitsToRetry(steps)
  if (retryUnitIds.length === 0) return { ok: true, retried: 0 }

  const stepByUnit = new Map<string, StepRow>(((stepRows ?? []) as StepRow[]).map((row) => [String(row.unit_id), row]))
  const retrySet = new Set(retryUnitIds)

  // Set only on the field-audit branch, and read after `finaliseRun` below —
  // a retried unit's task has to reflect the run's *final* recorded outcome,
  // the same way a first run's does.
  let fieldAuditTasks: { checks: FieldAuditCheck[]; findings: FieldAuditFinding[] } | null = null

  // Pinned prompt version, never the published one — see the header
  // comment. A run's `prompt_version_id` is set once, at `openRun`, and
  // retry reads that same id back rather than going through
  // `loadPublishedPrompt`/`prompt_publications` at all.
  const prompt = await loadPromptVersionById(client, String(runRow.prompt_version_id))
  if (!prompt) return { ok: false, message: `Prompt version ${runRow.prompt_version_id} no longer exists.` }

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

  if (runRow.kind === 'field_audit') {
    if (prompt.body.kind !== 'field_audit') {
      return { ok: false, message: `Prompt version ${prompt.versionId} is not a field audit, but run ${runId} is.` }
    }
    const checks = prompt.body.checks.filter((check) => retrySet.has(check.number))
    if (checks.length === 0) {
      return {
        ok: false,
        message: `None of the failed units (${retryUnitIds.join(', ')}) are still in "${prompt.title}" version ${prompt.versionNumber}.`,
      }
    }

    // The evidence this run actually saw, pinned at `openRun` time so a
    // retry an hour later answers the same question the run asked. Never
    // re-read `design_sheets`: a sheet edited since belongs to a fresh run.
    const values = (runRow.resolved_inputs ?? {}) as Record<string, unknown>

    const result = await runFieldAudit(
      {
        promptSlug: prompt.slug,
        promptVersion: prompt.versionNumber,
        values,
        matterId: String(runRow.matter_id),
        userId: deps.userId ?? null,
      },
      { ...prompt.body, checks },
      { callModel: deps.callModel, model: deps.model ?? runRow.model ?? undefined, onUnitSettled },
    )

    const deleted = await deleteSupersededFindings(client, retryUnitIds, stepByUnit)
    if (!deleted.ok) return deleted

    const saved = await saveFieldAuditFindings(client, runId, result)
    if (!saved.ok) return { ok: false, message: saved.message }

    // Findings for the retried checks only — same restriction `emitTasks`
    // applies again itself via `unitIds`, kept here too so the check list
    // handed to it matches the units it is being asked to emit for.
    fieldAuditTasks = { checks, findings: actionableFindings(result) }
  } else if (runRow.kind === 'review') {
    if (prompt.body.kind !== 'review') {
      return { ok: false, message: `Prompt version ${prompt.versionId} is not a review, but run ${runId} is.` }
    }
    const rules = prompt.body.rules.filter((rule) => retrySet.has(rule.number))
    if (rules.length === 0) {
      return {
        ok: false,
        message: `None of the failed units (${retryUnitIds.join(', ')}) are still in "${prompt.title}" version ${prompt.versionNumber}.`,
      }
    }
    if (!runRow.text_layer_id || !runRow.document_version_id) {
      return { ok: false, message: `Run ${runId} has no stored text layer to replay against.` }
    }

    // The layer this run actually reviewed, read back rather than
    // re-extracted — nothing is re-fetched from R2. Retrying a rule against
    // a document redlined since the run would anchor its citation to text
    // that no longer matches these offsets; a fresh run is how you review
    // the current draft.
    const { data: layerRow, error: layerError } = await client
      .from('document_text_layers')
      .select('source_kind, status, extractor, extractor_version, source_sha256, page_count, text, blocks, spans')
      .eq('id', runRow.text_layer_id)
      .maybeSingle()
    if (layerError) return { ok: false, message: `Could not load the stored text layer: ${layerError.message}` }
    const layer = toLayer(layerRow)
    if (!layer) return { ok: false, message: `Text layer ${runRow.text_layer_id} no longer exists.` }

    const result = await runReviewPlaybook(
      layer,
      { slug: prompt.slug, title: prompt.title, version: prompt.versionNumber, rules },
      { callModel: deps.callModel, model: deps.model ?? runRow.model ?? undefined, userId: deps.userId ?? null, onUnitSettled },
    )

    const deleted = await deleteSupersededFindings(client, retryUnitIds, stepByUnit)
    if (!deleted.ok) return deleted

    const saved = await saveReviewFindings(client, {
      runId,
      documentVersionId: String(runRow.document_version_id),
      textLayerId: String(runRow.text_layer_id),
      result,
    })
    if (!saved.ok) return { ok: false, message: saved.message }
  } else {
    return { ok: false, message: `Unknown run kind "${String(runRow.kind)}".` }
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
      matterId: String(runRow.matter_id),
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
