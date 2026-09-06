import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ReviewFinding, ReviewResult } from '@aubrey-law/citations/review/types'
import type { Json } from '@aubrey-law/db-types'
import type { RunStep } from '@/lib/runs/steps'

/**
 * Recording a review so it outlives the page.
 *
 * A run is only ever recorded against a *filed* document. An upload has no
 * durable identity, so a saved run about one would carry citations anchored to
 * nothing — which is precisely the failure the citation model exists to avoid.
 * Reviewing an upload stays ephemeral, and the screen says so.
 *
 * Split into the same three phases `lib/fieldAudit/persist.ts` and
 * `lib/fieldAudit/run.ts` use — see the migration's header comment
 * (20261030000000_run_steps.sql) for why the run row now has to exist before
 * the engine starts:
 *
 *  1. `saveTextLayer` persists the layer a review is about to run against,
 *     so its id exists to pin on the run — `openRun` (`lib/runs/record.ts`)
 *     does that next, in the route handler, before the engine runs.
 *  2. Each rule's outcome is written with `recordStep` as it settles.
 *  3. `saveFindings` stores what came back and links each finding to its
 *     step, then `finaliseRun` sets the run's status and counts.
 *
 * `saveRun` — one call doing all of this at the very end — and
 * `runStatusFor`, which computed the run's status from finding/failure
 * counts and disagreed with `lib/fieldAudit/persist.ts`'s own version of the
 * same question, are both gone. `statusFromSteps` in `lib/runs/steps.ts` is
 * the one function either kind of run reads its status from now.
 */
/**
 * A citation shape on its way into a `jsonb` column.
 *
 * `Json` requires an index signature, which an interface does not structurally
 * satisfy, so `TextBlock[]` and `BoundingBox` are rejected despite serialising
 * perfectly. Enumerating their fields instead would compile and then silently
 * drop any field added later — on geometry the whole citation model depends on
 * being exact. So the shape is asserted and every field survives the round
 * trip, which `toStoredRun` reads back.
 *
 * This asserts nothing about column *names*: those stay checked, which is the
 * mistake that put `matters.title` into five features.
 */
const asJson = (value: unknown): Json => value as Json

export const WORKFLOW_RUN_COLUMNS = [
  'id',
  'matter_id',
  'document_version_id',
  'text_layer_id',
  'prompt_version_id',
  'kind',
  'model',
  'status',
  'rule_total',
  'finding_count',
  'failed_count',
  'failures',
  'started_at',
  'finished_at',
  'created_by',
] as const

export const WORKFLOW_FINDING_COLUMNS = [
  'id',
  'run_id',
  'rule_number',
  'outcome',
  'severity',
  'rationale',
  'proposed_language',
  'citation_refusal',
  'attempted_quote',
  'disposition',
  'disposition_note',
  'disposition_by',
  'disposition_at',
  'created_at',
] as const

export interface SaveTextLayerInput {
  documentVersionId: string
  layer: TextLayer
}

/**
 * Persists the layer a review is about to run against.
 *
 * Called before `openRun`, not after: every stored citation is a pair of
 * offsets into this layer's text, so `text_layer_id` has to already exist to
 * be pinned on the run — the same guarantee `resolved_inputs` gives a field
 * audit, which a review has had since the start.
 */
export async function saveTextLayer(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveTextLayerInput,
): Promise<{ ok: true; layerId: string } | { ok: false; message: string }> {
  const { data, error } = await client
    .from('document_text_layers')
    .upsert(
      {
        document_version_id: input.documentVersionId,
        source_kind: input.layer.sourceKind,
        status: input.layer.status,
        extractor: input.layer.extractor,
        extractor_version: input.layer.extractorVersion,
        source_sha256: input.layer.sourceSha256,
        page_count: input.layer.pageCount,
        text: input.layer.text,
        blocks: asJson(input.layer.blocks),
        spans: asJson(input.layer.spans),
      },
      { onConflict: 'document_version_id,source_kind' },
    )
    .select('id')
    .single()
  if (error) return { ok: false, message: `Could not store the text layer: ${error.message}` }
  return { ok: true, layerId: String(data.id) }
}

export interface SaveFindingsInput {
  runId: string
  documentVersionId: string
  textLayerId: string
  result: ReviewResult
}

/**
 * Stores this run's findings and their verified citations, and links each
 * finding back to the step that produced it — `finding_id` on
 * `workflow_run_steps` is set here, in this third phase, once a finding
 * actually exists to point at. Mirrors `lib/fieldAudit/persist.ts`'s
 * `saveFindings`.
 *
 * Also carries the run's failures onto `workflow_runs.failures`, which the
 * run page has always read to show why a rule was lost. This restructure
 * changes when a run is recorded, not what it shows.
 */
export async function saveFindings(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveFindingsInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = client

  for (const finding of input.result.findings) {
    const { data: findingRow, error: findingError } = await sb
      .from('workflow_findings')
      .insert({
        run_id: input.runId,
        rule_number: finding.ruleNumber,
        outcome: finding.outcome,
        severity: finding.severity,
        rationale: finding.rationale,
        proposed_language: finding.proposedLanguage,
        citation_refusal: finding.citationRefusal,
        attempted_quote: finding.attemptedQuote,
      })
      .select('id')
      .single()
    if (findingError) return { ok: false, message: `Could not store a finding: ${findingError.message}` }

    // Only a verified citation is stored. An unverified one is a claim the
    // document has not been shown to support, and a row nobody filters on is
    // how an exclusion rule quietly stops being enforced.
    if (finding.citation && finding.citation.verification === 'verified') {
      const { error: citationError } = await sb.from('workflow_citations').insert({
        finding_id: findingRow.id,
        text_layer_id: input.textLayerId,
        document_version_id: input.documentVersionId,
        block_index: finding.citation.blockIndex,
        char_start: finding.citation.charStart,
        char_end: finding.citation.charEnd,
        page: finding.citation.page,
        bbox: asJson(finding.citation.bbox),
        quote: finding.citation.quote,
        verification: finding.citation.verification,
      })
      if (citationError) {
        return { ok: false, message: `Could not store a citation: ${citationError.message}` }
      }
    }

    const { error: linkError } = await sb
      .from('workflow_run_steps')
      .update({ finding_id: findingRow.id })
      .eq('run_id', input.runId)
      .eq('unit_id', finding.ruleNumber)
    if (linkError) {
      return { ok: false, message: `Could not link the finding to its step: ${linkError.message}` }
    }
  }

  const { error: failuresError } = await sb
    .from('workflow_runs')
    .update({ failures: asJson(input.result.failures) })
    .eq('id', input.runId)
  if (failuresError) {
    return { ok: false, message: `Could not record the run's failures: ${failuresError.message}` }
  }

  return { ok: true }
}

export type Disposition = 'open' | 'accepted' | 'rejected' | 'deferred'

export async function saveDisposition(
  client: SupabaseClient<WorkbenchDatabase>,
  input: { findingId: string; disposition: Disposition; note: string | null; userId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await client
    .from('workflow_findings')
    .update({
      disposition: input.disposition,
      disposition_note: input.note,
      // Cleared when reopened, so the row never carries a decision and no time.
      disposition_by: input.disposition === 'open' ? null : input.userId,
      disposition_at: input.disposition === 'open' ? null : new Date().toISOString(),
    })
    .eq('id', input.findingId)

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

export interface StoredFinding extends ReviewFinding {
  findingId: string
  disposition: Disposition
  dispositionNote: string | null
}

export interface StoredRun {
  runId: string
  matterId: string
  /** Null only for a run recorded before this column existed — a review always has a document. */
  documentVersionId: string | null
  kind: string
  /** The version the run was checked against. Null for a run recorded before this column existed. */
  promptVersionId: string | null
  /** The prompt's current slug and this version's number, when that version's prompt still resolves. */
  promptSlug: string | null
  promptVersionNumber: number | null
  status: string
  ruleTotal: number
  failedCount: number
  failures: Array<{ ruleNumber: string; reason: string }>
  finishedAt: string | null
  findings: StoredFinding[]
  layer: TextLayer | null
  steps: RunStep[]
}
