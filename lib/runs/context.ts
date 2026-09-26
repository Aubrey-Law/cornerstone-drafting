import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { loadPromptVersionById, type PublishedPrompt } from '@/lib/prompts/repository'
import type { FieldAuditBody, FieldAuditCheck, PromptBody } from '@aubrey-law/citations/prompt/body'
import type { ReviewRule } from '@aubrey-law/citations/review/types'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import { toLayer } from '@/lib/review/history'
import { parseMatterFacts, type MatterFacts } from '@aubrey-law/citations/review/conditions'

/**
 * What a run was asked to do, rebuilt from what it actually pinned.
 *
 * Retry and the tick both need exactly this: the prompt body at the run's own
 * `prompt_version_id` — never the currently published version, because
 * finishing a run means answering the same question it already asked, even
 * if the prompt has since been edited and republished — and the pinned
 * evidence for its kind: `resolved_inputs` for a field audit, the stored text
 * layer for a review. Neither re-reads its live source; a sheet or document
 * edited since the run belongs to a fresh run, not this one. Two copies of
 * this rebuild would drift, and the drift would look like a queued run and a
 * retried run disagreeing about the same document.
 */

export type ReviewBody = Extract<PromptBody, { kind: 'review' }>

export interface RunRow {
  id: string
  kind: string
  prompt_version_id: string | null
  /** Null for a review of an unfiled upload; a field audit always has one. */
  matter_id: string | null
  resolved_inputs: unknown
  /** Null for a run made before the render was versioned. */
  render_version: number | null
  text_layer_id: string | null
  document_version_id: string | null
  /** Set in place of `document_version_id` when the review is of an unfiled upload. */
  review_upload_id?: string | null
  model: string | null
}

export type RunContextResult =
  | { ok: true; kind: 'field_audit'; run: RunRow; prompt: PublishedPrompt; values: Record<string, unknown> }
  | {
      ok: true
      kind: 'review'
      run: RunRow
      prompt: PublishedPrompt
      layer: TextLayer
      /** Pinned at `openRun`; null for an older run or a matter with no sheet — every rule runs. */
      matterFacts: MatterFacts | null
    }
  | { ok: false; message: string }

/**
 * Loads the run, its pinned prompt version, and the rebuilt evidence for its
 * kind. `runId` is all a caller ever has to work from.
 */
export async function loadRunContext(
  client: SupabaseClient<GeneratedDatabase>,
  runId: string,
): Promise<RunContextResult> {
  const { data: runRow, error: runError } = await client
    .from('workflow_runs')
    .select('id, kind, prompt_version_id, matter_id, resolved_inputs, text_layer_id, document_version_id, review_upload_id, model, render_version')
    .eq('id', runId)
    .maybeSingle()
  if (runError) return { ok: false, message: `Could not load the run: ${runError.message}` }
  if (!runRow) return { ok: false, message: `No run ${runId}.` }
  if (!runRow.prompt_version_id) {
    return { ok: false, message: `Run ${runId} has no prompt version recorded, so there is nothing to retry against.` }
  }

  // Pinned prompt version, never the published one — see the header comment.
  // A run's `prompt_version_id` is set once, at `openRun`, and this reads
  // that same id back rather than going through
  // `loadPublishedPrompt`/`prompt_publications` at all.
  const prompt = await loadPromptVersionById(client, String(runRow.prompt_version_id))
  if (!prompt) return { ok: false, message: `Prompt version ${runRow.prompt_version_id} no longer exists.` }

  if (runRow.kind === 'field_audit') {
    if (prompt.body.kind !== 'field_audit') {
      return { ok: false, message: `Prompt version ${prompt.versionId} is not a field audit, but run ${runId} is.` }
    }
    // The evidence this run actually saw, pinned at `openRun` time so a
    // retry an hour later answers the same question the run asked. Never
    // re-read `design_sheets`: a sheet edited since belongs to a fresh run.
    const values = (runRow.resolved_inputs ?? {}) as Record<string, unknown>
    return { ok: true, kind: 'field_audit', run: runRow, prompt, values }
  }

  if (runRow.kind === 'review') {
    if (prompt.body.kind !== 'review') {
      return { ok: false, message: `Prompt version ${prompt.versionId} is not a review, but run ${runId} is.` }
    }
    if (!runRow.text_layer_id || (!runRow.document_version_id && !runRow.review_upload_id)) {
      return { ok: false, message: `Run ${runId} has no stored text layer to replay against.` }
    }

    // The layer this run actually reviewed, read back rather than
    // re-extracted — nothing is re-fetched from R2. Replaying against a
    // document edited since the run would anchor a citation to text that no
    // longer matches these offsets; a fresh run is how you review the
    // current draft.
    const { data: layerRow, error: layerError } = await client
      .from('document_text_layers')
      .select('source_kind, status, extractor, extractor_version, source_sha256, page_count, text, blocks, spans')
      .eq('id', runRow.text_layer_id)
      .maybeSingle()
    if (layerError) return { ok: false, message: `Could not load the stored text layer: ${layerError.message}` }
    const layer = toLayer(layerRow)
    if (!layer) return { ok: false, message: `Text layer ${runRow.text_layer_id} no longer exists.` }
    return { ok: true, kind: 'review', run: runRow, prompt, layer, matterFacts: parseMatterFacts(runRow.resolved_inputs) }
  }

  return { ok: false, message: `Unknown run kind "${String(runRow.kind)}".` }
}

/**
 * The units of a prompt body that are still to do — every one of them when
 * nothing is named, or only the ones asked for, in the body's own order.
 *
 * The body's order, not the order asked for: a playbook's order is the order
 * its author meant, and the prompt cache depends on the document sitting
 * ahead of a varying unit. Reordering would not break correctness but it
 * would make a run read wrongly.
 */
export function unitsFor(body: FieldAuditBody, only: string[] | null): FieldAuditCheck[]
export function unitsFor(body: ReviewBody, only: string[] | null): ReviewRule[]
export function unitsFor(body: PromptBody, only: string[] | null): FieldAuditCheck[] | ReviewRule[] {
  const all = body.kind === 'field_audit' ? body.checks : body.rules
  if (!only) return all
  const wanted = new Set(only)
  return (all as Array<{ number: string }>).filter((unit) => wanted.has(unit.number)) as
    | FieldAuditCheck[]
    | ReviewRule[]
}
