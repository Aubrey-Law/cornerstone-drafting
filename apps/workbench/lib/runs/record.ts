import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { Json } from '@aubrey-law/db-types'
import { statusFromSteps, type RunStep } from './steps'

/**
 * The three phases a run is now recorded in, replacing "run the engine, then
 * insert everything at the end" — see the migration's header comment
 * (20261030000000_run_steps.sql) for why that order left nothing behind when
 * a run died mid-flight.
 *
 *   1. `openRun` — insert the run as `running`, with its pinned evidence.
 *   2. The engine runs; each unit's outcome is written with `recordStep` as
 *      it settles, through `onUnitSettled`.
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

/** The row `openRun` inserts — a run that exists, but has not done anything yet. */
export function openRunRowFor(input: OpenRunInput) {
  return {
    matter_id: input.matterId,
    document_version_id: input.documentVersionId,
    text_layer_id: input.textLayerId,
    prompt_version_id: input.promptVersionId,
    kind: input.kind,
    model: input.model,
    status: 'running' as const,
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
 * Inserts the run as `running`, before the engine has done anything. Returns
 * its id, which every step written during the run references.
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
      status: 'running',
      rule_total: input.unitTotal,
      finding_count: 0,
      failed_count: 0,
      resolved_inputs: asJson(input.resolvedInputs),
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
