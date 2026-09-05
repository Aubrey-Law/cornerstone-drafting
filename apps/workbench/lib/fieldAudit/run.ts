import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { loadSourceRows } from '@/lib/prompts/designSheet'
import { actionableFindings, runFieldAudit } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import { resolveInputs } from '@aubrey-law/citations/prompt/inputs'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import { saveAuditRun } from './persist'
import { emitTasks } from './tasks'

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
 * Every failure here is one a person reading the message can act on, or know
 * they cannot — which is the same split `resolveInputs` draws between
 * `missing` and `unresolvable`, carried through to what the screen says:
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

  const result = await runFieldAudit(
    {
      promptSlug: prompt.slug,
      promptVersion: prompt.versionNumber,
      values: resolved.values,
      matterId: options.matterId,
      userId: options.userId,
    },
    prompt.body,
    { callModel: options.callModel, model: options.model },
  )

  const saved = await saveAuditRun(client, {
    matterId: options.matterId,
    promptVersionId: prompt.versionId,
    result,
    model: options.model ?? null,
    userId: options.userId,
  })
  if (!saved.ok) return { ok: false, message: saved.message }

  const { created } = await emitTasks(client, {
    matterId: options.matterId,
    runId: saved.runId,
    checks: prompt.body.checks,
    findings: actionableFindings(result),
  })

  return { ok: true, runId: saved.runId, findingCount: result.findings.length, tasksCreated: created }
}
