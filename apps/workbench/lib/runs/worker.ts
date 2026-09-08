import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { FieldAuditBody } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding as FieldAuditFindingType, FieldAuditResult } from '@aubrey-law/citations/fieldAudit/types'
import type { ReviewFinding, ReviewResult } from '@aubrey-law/citations/review/types'
import { recordStep, type UnitOutcome } from './record'
import { toRunSteps, type RunStep } from './steps'
import { saveFindings as saveFieldAuditFindings } from '@/lib/fieldAudit/persist'
import { saveFindings as saveReviewFindings } from '@/lib/review/persist'
import { unitsFor, type ReviewBody, type RunContextResult } from './context'

/**
 * How long a tick will work before leaving the rest for the next one.
 *
 * `maxDuration` is 300 seconds. Stopping at 240 leaves room for the unit in
 * flight to finish and for the run to be finalised: a worker killed at the
 * ceiling loses the unit it was mid-way through, and that unit's model call
 * has already been paid for.
 */
export const TICK_BUDGET_MS = 240_000

/** A unit takes about ten seconds; starting one without room spends the money and loses the answer. */
const UNIT_HEADROOM_MS = 15_000

export function budgetExhausted(startedAt: number, now: number): boolean {
  return now - startedAt >= TICK_BUDGET_MS - UNIT_HEADROOM_MS
}

/** The context a worker is handed once its run is known to exist and be well-formed. */
export type RunContext = Extract<RunContextResult, { ok: true }>

export interface WorkerDependencies {
  callModel: ModelCaller
  model?: string
  userId?: string | null
  /** Injected clock, so the budget is testable without waiting on it. */
  now: () => number
}

export interface WorkResult {
  /** No `pending` steps remain — the caller's cue to `finaliseRun` and, for a field audit, `emitTasks`. */
  done: boolean
  worked: number
}

async function loadSteps(client: SupabaseClient<WorkbenchDatabase>, runId: string): Promise<RunStep[]> {
  const { data, error } = await client
    .from('workflow_run_steps')
    .select('unit_id, status, sequence, attempts, last_error, finding_id')
    .eq('run_id', runId)
  if (error) throw new Error(`Could not load the run's steps: ${error.message}`)
  return toRunSteps((data ?? []) as never[])
}

/**
 * Works a run's `pending` steps, one at a time, until either none remain or
 * the time budget runs out.
 *
 * One unit per model call rather than the whole remaining body in one engine
 * call: `runPrompt` (the shared loop under both `runFieldAudit` and
 * `runReviewPlaybook`) has no way to stop partway through a batch, and
 * stopping partway through is the entire point of a budget. Calling it once
 * per unit is what makes `budgetExhausted` checkable between units.
 *
 * Findings are only stored once, after the loop — `saveFindings` also
 * overwrites `workflow_runs.failures` with whatever it is handed, so calling
 * it per unit would make each call erase the last one's failures. Steps are
 * still recorded as each unit settles (`recordStep`, via `onUnitSettled`),
 * which is what makes a step's outcome durable even if the process is killed
 * before the findings are saved.
 *
 * Never calls `finaliseRun` or `emitTasks` itself: a worker that emitted
 * tasks halfway through a run would create them for findings the run had not
 * finished disagreeing with. Both belong to the caller, once `done` is true.
 */
export async function workRun(
  client: SupabaseClient<WorkbenchDatabase>,
  context: RunContext,
  deps: WorkerDependencies,
): Promise<WorkResult> {
  const runId = context.run.id
  const startedAt = deps.now()

  const steps = await loadSteps(client, runId)
  const pending = steps.filter((step) => step.status === 'pending').sort((a, b) => a.sequence - b.sequence)

  const findings: Array<FieldAuditFindingType | ReviewFinding> = []
  const failures: Array<{ checkNumber?: string; ruleNumber?: string; reason: string }> = []
  let worked = 0

  for (const step of pending) {
    if (budgetExhausted(startedAt, deps.now())) break

    const attempts = step.attempts + 1
    const onUnitSettled = async (unitId: string, outcome: UnitOutcome): Promise<void> => {
      await recordStep(client, runId, unitId, step.sequence, outcome, attempts)
    }

    if (context.kind === 'field_audit') {
      const { prompt, values, run } = context
      const checks = unitsFor(prompt.body as FieldAuditBody, [step.unitId])
      const result = await runFieldAudit(
        {
          promptSlug: prompt.slug,
          promptVersion: prompt.versionNumber,
          // The run's own pinned render, not the deployed constant.
          renderVersion: run.render_version,
          values,
          matterId: String(run.matter_id),
          userId: deps.userId ?? null,
        },
        { ...(prompt.body as FieldAuditBody), checks },
        { callModel: deps.callModel, model: deps.model ?? run.model ?? undefined, onUnitSettled },
      )
      findings.push(...result.findings)
      failures.push(...result.failures)
    } else {
      const { prompt, layer, run } = context
      const rules = unitsFor(prompt.body as ReviewBody, [step.unitId])
      const result = await runReviewPlaybook(
        layer,
        { slug: prompt.slug, title: prompt.title, version: prompt.versionNumber, rules },
        {
          callModel: deps.callModel,
          model: deps.model ?? run.model ?? undefined,
          userId: deps.userId ?? null,
          // The run's own pinned render, not the deployed constant.
          renderVersion: run.render_version,
          onUnitSettled,
        },
      )
      findings.push(...result.findings)
      failures.push(...result.failures)
    }

    const { error: tickError } = await client
      .from('workflow_runs')
      .update({ last_tick_at: new Date(deps.now()).toISOString() })
      .eq('id', runId)
    if (tickError) throw new Error(`Could not stamp the run's heartbeat: ${tickError.message}`)

    worked += 1
  }

  if (worked > 0) {
    if (context.kind === 'field_audit') {
      const { prompt } = context
      const result: FieldAuditResult = {
        promptSlug: prompt.slug,
        promptVersion: prompt.versionNumber,
        findings: findings as FieldAuditFindingType[],
        failures: failures as FieldAuditResult['failures'],
      }
      const saved = await saveFieldAuditFindings(client, runId, result)
      if (!saved.ok) throw new Error(saved.message)
    } else {
      const { prompt, run } = context
      const result: ReviewResult = {
        playbookSlug: prompt.slug,
        playbookVersion: prompt.versionNumber,
        findings: findings as ReviewFinding[],
        failures: failures as ReviewResult['failures'],
      }
      const saved = await saveReviewFindings(client, {
        runId,
        documentVersionId: String(run.document_version_id),
        textLayerId: String(run.text_layer_id),
        result,
      })
      if (!saved.ok) throw new Error(saved.message)
    }
  }

  const stepsAfter = await loadSteps(client, runId)
  const done = !stepsAfter.some((step) => step.status === 'pending' || step.status === 'running')

  return { done, worked }
}
