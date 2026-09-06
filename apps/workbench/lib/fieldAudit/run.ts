import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { Json } from '@aubrey-law/db-types'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { openRun, recordStep, finaliseRun } from '@/lib/runs/record'
import type { RunStep } from '@/lib/runs/steps'
import { actionableFindings, runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { resolveInputs } from '@aubrey-law/citations/prompt/inputs'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import { saveFindings } from './persist'
import { emitTasks } from './tasks'

const asJson = (value: unknown): Json => value as Json

export interface RunMatterAuditOptions {
  slug: string
  matterId: string
  userId: string
  callModel: ModelCaller
  model?: string
}

export type RunMatterAuditResult =
  | { ok: true; runId: string; findingCount: number; tasksCreated: number }
  | { ok: false; message: string }

/**
 * The whole path from "an attorney picked a prompt and a matter" to
 * "findings are recorded and verified findings are tasks".
 *
 * Runs in three phases now, not one pass at the end:
 *
 *  1. `openRun` inserts the run as `running`, pinning the resolved design-sheet
 *     values a retry will later replay against instead of re-reading
 *     `design_sheets` — see the migration's header comment for why a sheet
 *     edited between a run and its retry would otherwise leave two findings
 *     side by side answering different questions.
 *  2. `runFieldAudit` runs the engine; `onUnitSettled` writes each check's
 *     outcome with `recordStep` as it settles, before the next check starts.
 *  3. `saveFindings` stores what came back and links each finding to its
 *     step, then `finaliseRun` sets the run's status and counts from the
 *     steps themselves.
 *
 * This is what turns "a run killed mid-flight leaves nothing" into "a run
 * killed mid-flight leaves a `running` row with however many steps settled
 * before it died" — a failure you can look at instead of one you can only
 * infer.
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

  // Filled in as each check settles, in the order it settled — which is
  // playbook order, since runPrompt runs one unit at a time. This is what
  // `finaliseRun` reads the run's status and counts from.
  const steps: RunStep[] = []
  let sequence = 0

  const result = await runFieldAudit(
    {
      promptSlug: prompt.slug,
      promptVersion: prompt.versionNumber,
      values: resolved.values,
      matterId: options.matterId,
      userId: options.userId,
    },
    prompt.body,
    {
      callModel: options.callModel,
      model: options.model,
      onUnitSettled: async (unitId, outcome) => {
        const stepSequence = sequence
        sequence += 1
        await recordStep(client, runId, unitId, stepSequence, outcome, 1)
        steps.push({
          unitId,
          status: outcome.ok ? 'succeeded' : 'failed',
          attempts: 1,
          sequence: stepSequence,
        })
      },
    },
  )

  const saved = await saveFindings(client, runId, result)
  if (!saved.ok) return { ok: false, message: saved.message }

  await finaliseRun(client, runId, steps)

  const { created } = await emitTasks(client, {
    matterId: options.matterId,
    runId,
    checks: prompt.body.checks,
    findings: actionableFindings(result),
  })

  return { ok: true, runId, findingCount: result.findings.length, tasksCreated: created }
}
