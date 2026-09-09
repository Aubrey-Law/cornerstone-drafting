import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { runMatterAudit, type RunMatterAuditResult } from '@/lib/fieldAudit/run'

/**
 * Turning one claimed `prompt_stage_triggers` row into a queued run, or into
 * a recorded skip — the tick's counterpart to a person picking a prompt and
 * a matter on `/prompts`.
 *
 * The trigger (the Postgres one, in `20261103000000_stage_triggered_runs.sql`)
 * stays deliberately dumb: it knows a stage was entered and which prompts
 * declare they fire on it, and nothing else. Resolving a prompt's declared
 * inputs against the design-sheet allow-list and deciding whether that
 * succeeded is app logic with a zod schema behind it — `runMatterAudit` is
 * already that whole path, so this module's job is only to call it with the
 * right arguments and record what it said.
 */

export interface Settlement {
  status: 'done' | 'skipped'
  runId: string | null
  lastError: string | null
}

/**
 * What a claimed trigger becomes, from what `runMatterAudit` reported.
 *
 * A failure here — no design sheet, a required field nobody filled in — is
 * `skipped`, never `failed`. A matter reaching `drafting` with an empty
 * `concerns` field is not a run that failed; it is a run that should not
 * have started, and recording it as a failure would make `failed_count` mean
 * something else and fill `/prompts` with runs that never had a chance to
 * say anything true.
 */
export function settlementFor(result: RunMatterAuditResult): Settlement {
  if (result.ok) return { status: 'done', runId: result.runId, lastError: null }
  return { status: 'skipped', runId: null, lastError: result.message }
}

/**
 * What a *thrown* error becomes.
 *
 * `runMatterAudit` returns `ok: false` for everything it anticipates, and
 * throws for everything else — a query that fails, a column that rejects what
 * it was handed. Nothing caught those, so the exception left the tick through
 * `materialiseStageTrigger` and the trigger stayed `claimed`: no run, no
 * `last_error`, no report, and `claim_prompt_stage_trigger` only ever selects
 * `pending`, so nothing would ever pick it up again.
 *
 * Measured 2026-09-09. Six triggers were queued across six matters; the tick
 * claimed one a minute exactly on schedule and settled four. Two threw and
 * were stranded, and the only reason anybody noticed is that six triggers
 * produced four results. Both were the same cause — a design sheet whose slot
 * `contact_id` is the sentinel `__design_sheet_client__` rather than a uuid,
 * which Postgres rejects when it reaches a uuid column — and 7 of 44 sheets
 * carry such a value.
 *
 * `skipped`, deliberately, and for the reason the type's own comment already
 * gives: this is not a run that failed, it is a run that never started. The
 * difference from a missing required field is only that nobody anticipated it,
 * which is an argument for recording it, not for hiding it.
 */
export function settlementForThrown(error: unknown): Settlement {
  const message = error instanceof Error ? error.message : String(error)
  return { status: 'skipped', runId: null, lastError: message }
}

export interface MaterialiseResult {
  claimed: boolean
  runId: string | null
  status: string | null
}

/**
 * Claims one pending stage trigger and materialises it, or reports that
 * there was nothing to claim.
 */
export async function materialiseStageTrigger(
  client: SupabaseClient<WorkbenchDatabase>,
  worker: string,
): Promise<MaterialiseResult> {
  const { data: claimed, error: claimError } = await client.rpc('claim_prompt_stage_trigger', { p_worker: worker })
  if (claimError) throw new Error(`Could not claim a stage trigger: ${claimError.message}`)

  // Same trap `claim_workflow_run` documents at length in the tick route
  // (apps/workbench/app/api/cron/tick/route.ts): `claim_prompt_stage_trigger`
  // is a composite-returning plpgsql function, so an empty claim comes back
  // as HTTP 200 with a full row whose every column is null — not JSON
  // `null`. `!claimed` is therefore never true here, and guarding on it would
  // read "nothing pending" as "claimed a trigger whose id is null", sending
  // this on to look up a prompt for a null id. The guard has to be on the id.
  const claimedRow = claimed as Record<string, unknown> | null
  if (claimedRow?.id == null) {
    return { claimed: false, runId: null, status: null }
  }

  const triggerId = String(claimedRow.id)
  const matterId = String(claimedRow.matter_id)
  const promptId = String(claimedRow.prompt_id)

  const { data: promptRow, error: promptError } = await client
    .from('prompts')
    .select('slug')
    .eq('id', promptId)
    .maybeSingle()
  if (promptError) {
    throw new Error(`Could not look up the prompt for stage trigger ${triggerId}: ${promptError.message}`)
  }
  if (!promptRow) {
    throw new Error(`Stage trigger ${triggerId} names prompt ${promptId}, which no longer exists.`)
  }

  // A throw here used to escape the tick and leave this trigger `claimed`
  // forever. Caught rather than propagated so the trigger settles and says
  // why — see `settlementForThrown`. The error is not swallowed: it lands in
  // `last_error` on the row, which is where a person looking at why a matter
  // was never audited will actually find it.
  let settlement: Settlement
  try {
    const result = await runMatterAudit(client, {
      slug: promptRow.slug,
      matterId,
      // No actor: the stage engine fired this, not an attorney — see
      // `RunMatterAuditOptions.userId`'s own comment in lib/fieldAudit/run.ts.
      userId: null,
      // The tick materialises and then works the queue in the same
      // invocation — see the tick route — so it is about to claim whatever run
      // this becomes without needing to be asked. Poking here would only ask a
      // second tick to start for work this one is already about to do.
      poke: false,
    })
    settlement = settlementFor(result)
  } catch (error) {
    settlement = settlementForThrown(error)
  }

  const { error: settleError } = await client
    .from('prompt_stage_triggers')
    .update({
      status: settlement.status,
      run_id: settlement.runId,
      last_error: settlement.lastError,
      settled_at: new Date().toISOString(),
    })
    .eq('id', triggerId)
  if (settleError) throw new Error(`Could not settle stage trigger ${triggerId}: ${settleError.message}`)

  return { claimed: true, runId: settlement.runId, status: settlement.status }
}
