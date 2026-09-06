import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { Json } from '@aubrey-law/db-types'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { openRun, openSteps } from '@/lib/runs/record'
import { pokeTick as realPokeTick } from '@/lib/runs/enqueue'
import { resolveInputs } from '@aubrey-law/citations/prompt/inputs'

const asJson = (value: unknown): Json => value as Json

export interface RunMatterAuditOptions {
  slug: string
  matterId: string
  // Null when the stage engine fired this rather than an attorney picking a
  // prompt and a matter — `workflow_runs.created_by` is nullable for exactly
  // that case, and inventing an actor would put a person's name on something
  // they did not do.
  userId: string | null
  model?: string
  // Off when the caller is a tick already working through the queue: it is
  // about to claim this run in the same invocation, and poking would only
  // ask a second tick to start for work this one is already doing.
  poke?: boolean
  // Injectable so a test can observe whether a poke happened without a real
  // network call. Defaults to the real `pokeTick`.
  pokeTick?: () => Promise<void>
}

export type RunMatterAuditResult =
  | { ok: true; runId: string; queued: true }
  | { ok: false; message: string }

/**
 * The whole path from "a prompt and a matter" to "a run is queued and on its
 * way" — whether the prompt and matter were an attorney's choice on
 * `/prompts`, or a stage entry the trigger fired (`userId: null`, `poke:
 * false` — see those fields' comments on `RunMatterAuditOptions`).
 *
 * Used to run the engine itself, in the same request, and report what it
 * found. The tick route now does that work — see
 * `apps/workbench/app/api/cron/tick/route.ts` — so this only enqueues:
 *
 *  1. `openRun` inserts the run as `queued`, pinning the resolved design-sheet
 *     values a retry (or the tick itself) will replay against instead of
 *     re-reading `design_sheets` — see the migration's header comment for why
 *     a sheet edited between a run and its retry would otherwise leave two
 *     findings side by side answering different questions.
 *  2. `openSteps` inserts one `pending` step per check, in the prompt body's
 *     own order, so the run's shape ("3 of 40") is known before any work
 *     happens.
 *  3. `pokeTick` nudges the tick route so work starts now rather than on the
 *     next cron — skipped when the caller is already inside a tick, which is
 *     about to claim this same run without needing to be asked.
 *
 * Tasks used to be created here too, once the engine returned. They belong
 * to the tick now — the only place a run is ever actually finished, whether
 * that took one tick or several. Creating them here as well would create a
 * queued run's tasks twice.
 *
 * Every failure before the run opens is one a person reading the message can
 * act on, or know they cannot — which is the same split `resolveInputs` draws
 * between `missing` and `unresolvable`, carried through to what the screen
 * says:
 *
 *  - `missing` names fields nobody has filled in yet. The design sheet is
 *    incomplete, and completing it is exactly what would let the audit run.
 *  - `unresolvable` names fields the prompt declares that no longer have a
 *    column behind them. No amount of editing the design sheet fixes that —
 *    the prompt itself is broken, and saying "please fill in X" here would
 *    send someone chasing a field that does not exist.
 */
export async function runMatterAudit(
  client: SupabaseClient<WorkbenchDatabase>,
  options: RunMatterAuditOptions,
): Promise<RunMatterAuditResult> {
  const prompt = await loadPublishedPrompt(client, options.slug)
  if (!prompt) return { ok: false, message: `No published prompt named "${options.slug}".` }
  if (prompt.body.kind !== 'field_audit') {
    return {
      ok: false,
      message: `"${prompt.title}" is a "${prompt.body.kind}" prompt, not a field audit — it cannot be run here.`,
    }
  }

  const rows = await loadSourceRows(client, options.matterId)
  if (!rows) {
    return { ok: false, message: 'That matter has no design sheet yet, so there is nothing for the audit to read.' }
  }

  const resolved = resolveInputs(prompt.body.inputs, rows)
  if (!resolved.ok) {
    if (resolved.unresolvable.length > 0) {
      // A broken prompt, not an incomplete design sheet — see the header
      // comment. Naming both would bury the one thing that actually matters:
      // no design-sheet edit fixes this.
      return {
        ok: false,
        message:
          `"${prompt.title}" references fields that no longer exist: ${resolved.unresolvable.join(', ')}. ` +
          'That is a broken prompt, not an incomplete design sheet — fix the prompt before running it again.',
      }
    }
    return {
      ok: false,
      message:
        `The design sheet is missing fields this audit needs to say anything true: ${resolved.missing.join(', ')}.`,
    }
  }

  const runId = await openRun(client, {
    matterId: options.matterId,
    kind: 'field_audit',
    promptVersionId: prompt.versionId,
    model: options.model ?? null,
    unitTotal: prompt.body.checks.length,
    userId: options.userId,
    resolvedInputs: asJson(resolved.values),
    documentVersionId: null,
    textLayerId: null,
  })

  // The body's own order — the order a tick will work them in.
  await openSteps(
    client,
    runId,
    prompt.body.checks.map((check) => check.number),
  )

  if (options.poke ?? true) {
    await (options.pokeTick ?? realPokeTick)()
  }

  return { ok: true, runId, queued: true }
}
