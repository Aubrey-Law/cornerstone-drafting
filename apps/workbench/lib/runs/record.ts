import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { Json } from '@aubrey-law/db-types'
import { statusFromSteps, type RunStep } from './steps'
import { CURRENT_FIELD_AUDIT_RENDER_VERSION } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { CURRENT_REVIEW_RENDER_VERSION } from '@aubrey-law/citations/review/runReview'

/**
 * The three phases a run is now recorded in, replacing "run the engine, then
 * insert everything at the end" — see the migration's header comment
 * (20261030000000_run_steps.sql) for why that order left nothing behind when
 * a run died mid-flight.
 *
 *   1. `openRun` — insert the run as `queued`, with its pinned evidence, and
 *      `openSteps` — insert one `pending` step per unit, so the run's shape
 *      ("3 of 40") is known before any work happens.
 *   2. A tick claims the run (`running` now means a worker holds it) and
 *      works its steps; each unit's outcome is written with `recordStep` as
 *      it settles.
 *   3. Findings are stored and linked to their step, then `finaliseRun` sets
 *      the run's status and counts from the steps themselves.
 */
const asJson = (value: unknown): Json => value as Json

export interface OpenRunInput {
  matterId: string
  kind: string
  promptVersionId: string
  model: string | null
  /** The number of units the engine is about to run — `rule_total`. */
  unitTotal: number
  userId: string | null
  /**
   * The evidence this run saw, pinned so a retry replays against it rather
   * than re-reading a design sheet that may have since changed. Null for a
   * review, which pins its evidence through `textLayerId` instead.
   */
  resolvedInputs: Json | null
  documentVersionId: string | null
  textLayerId: string | null
}

/**
 * The row `openRun` inserts — a run that exists, but has not done anything yet.
 *
 * `status` is `queued`, not `running`: the caller that opens a run no longer
 * runs the engine itself, it enqueues and returns. `running` now means a
 * tick has claimed the run — see `claim_workflow_run` — and a run sits
 * `queued` from here until that happens.
 */
export function openRunRowFor(input: OpenRunInput) {
  return {
    matter_id: input.matterId,
    document_version_id: input.documentVersionId,
    text_layer_id: input.textLayerId,
    prompt_version_id: input.promptVersionId,
    kind: input.kind,
    model: input.model,
    status: 'queued' as const,
    rule_total: input.unitTotal,
    finding_count: 0,
    failed_count: 0,
    resolved_inputs: input.resolvedInputs,
    started_at: new Date().toISOString(),
    finished_at: null as string | null,
    created_by: input.userId,
  }
}

export type UnitOutcome = { ok: true } | { ok: false; reason: string }

/** The row `recordStep` upserts for one unit as it settles. */
export function stepRowFor(runId: string, unitId: string, sequence: number, outcome: UnitOutcome, attempts: number) {
  const now = new Date().toISOString()
  return {
    run_id: runId,
    unit_id: unitId,
    sequence,
    status: outcome.ok ? ('succeeded' as const) : ('failed' as const),
    attempts,
    last_error: outcome.ok ? null : outcome.reason,
    started_at: now,
    finished_at: now,
  }
}

/**
 * Inserts the run as `queued`, before a tick has claimed it. Returns its id,
 * which every step written during the run references.
 *
 * Written inline rather than by spreading `openRunRowFor`'s return value —
 * see `lib/fieldAudit/persist.ts`'s header comment on inline column literals.
 * This codebase's offline column safety net (tests/query-columns.test.ts,
 * scripts/checkDbColumns.mjs) can only see a column name written as a literal
 * in the object passed straight to `.insert(...)`; a helper-built row is
 * invisible to it. `openRunRowFor` stays the pure, unit-tested statement of
 * the shape, and this call is kept matching it by hand.
 */
export async function openRun(client: SupabaseClient<WorkbenchDatabase>, input: OpenRunInput): Promise<string> {
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('workflow_runs')
    .insert({
      matter_id: input.matterId,
      document_version_id: input.documentVersionId,
      text_layer_id: input.textLayerId,
      prompt_version_id: input.promptVersionId,
      kind: input.kind,
      model: input.model,
      status: 'queued',
      rule_total: input.unitTotal,
      finding_count: 0,
      failed_count: 0,
      resolved_inputs: asJson(input.resolvedInputs),
      // Which render this run is answering against. Stamped now, so a retry
      // weeks later builds the same call rather than whatever is deployed
      // then — the other half of what pinning prompt_version_id is for. Per
      // kind, because the two registries hold different contracts.
      render_version:
        input.kind === 'field_audit'
          ? CURRENT_FIELD_AUDIT_RENDER_VERSION
          : CURRENT_REVIEW_RENDER_VERSION,
      // Written as well, for the minute or two after a deploy where the
      // previous release may still pick this run up and read only this
      // column. The two hold the same number today; the migration that drops
      // the column drops this line with it.
      instructions_version:
        input.kind === 'field_audit'
          ? CURRENT_FIELD_AUDIT_RENDER_VERSION
          : CURRENT_REVIEW_RENDER_VERSION,
      started_at: now,
      finished_at: null,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Could not open the run: ${error.message}`)
  return String(data.id)
}

/**
 * Inserts one `pending` step per unit, before any work has happened — the
 * opposite of `recordStep`, which only ever writes a step that has already
 * settled.
 *
 * Written at enqueue time, right after `openRun`, so a run's shape is known
 * from the first moment: the page can say "3 of 40" immediately, rather than
 * counting up from nothing as steps trickle in.
 *
 * One row at a time, inline, rather than a single batched `.insert(rows)` —
 * for the same reason `lib/fieldAudit/persist.ts` stores its references one
 * at a time: the offline column checker (tests/query-columns.test.ts,
 * scripts/checkDbColumns.mjs) can only see a column name written as a
 * literal in the object passed straight to `.insert(...)`, and an array
 * literal is invisible to it — see scripts/lib/queryReferences.mjs.
 */
export async function openSteps(
  client: SupabaseClient<WorkbenchDatabase>,
  runId: string,
  unitIds: string[],
): Promise<void> {
  for (let sequence = 0; sequence < unitIds.length; sequence += 1) {
    const { error } = await client.from('workflow_run_steps').insert({
      run_id: runId,
      unit_id: unitIds[sequence],
      sequence,
      status: 'pending',
      attempts: 0,
      last_error: null,
      started_at: null,
      finished_at: null,
    })
    if (error) throw new Error(`Could not open the run's steps: ${error.message}`)
  }
}

/**
 * Upserts on `(run_id, unit_id)` so a retry updates the step that unit
 * already has instead of inserting a second one — the constraint the
 * migration puts on the table for exactly this reason.
 *
 * `attempts` is supplied by the caller rather than incremented here: the
 * caller is the one that knows whether this is a unit's first attempt or a
 * retry's, and this function only ever records what it is told.
 */
export async function recordStep(
  client: SupabaseClient<WorkbenchDatabase>,
  runId: string,
  unitId: string,
  sequence: number,
  outcome: UnitOutcome,
  attempts: number,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await client.from('workflow_run_steps').upsert(
    {
      run_id: runId,
      unit_id: unitId,
      sequence,
      status: outcome.ok ? 'succeeded' : 'failed',
      attempts,
      last_error: outcome.ok ? null : outcome.reason,
      started_at: now,
      finished_at: now,
    },
    { onConflict: 'run_id,unit_id' },
  )
  if (error) throw new Error(`Could not record the step: ${error.message}`)
}

/**
 * Sets the run's status and counts from what its steps actually did, and
 * stamps `finished_at`. The last of the three phases — called once every
 * finding a settled step produced has been stored and linked back to it.
 */
export async function finaliseRun(
  client: SupabaseClient<WorkbenchDatabase>,
  runId: string,
  steps: RunStep[],
): Promise<void> {
  const { error } = await client
    .from('workflow_runs')
    .update({
      status: statusFromSteps(steps),
      finding_count: steps.filter((step) => step.status === 'succeeded').length,
      failed_count: steps.filter((step) => step.status === 'failed').length,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId)
  if (error) throw new Error(`Could not finalise the run: ${error.message}`)
}
