import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ReviewFinding, ReviewResult } from '@aubrey-law/citations/review/types'
import type { Json } from '@aubrey-law/db-types'

/**
 * Recording a review so it outlives the page.
 *
 * A run is only ever recorded against a *filed* document. An upload has no
 * durable identity, so a saved run about one would carry citations anchored to
 * nothing — which is precisely the failure the citation model exists to avoid.
 * Reviewing an upload stays ephemeral, and the screen says so.
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

export type RunStatus = 'completed' | 'partial' | 'failed'

/**
 * The status is the one field a reader skims, so it may not overstate coverage.
 * A run that lost a rule to a failed call is `partial`; calling it `completed`
 * would claim every rule was applied when one never was. A run that lost every
 * rule learned nothing and must not read as a review at all.
 */
export function runStatusFor(counts: {
  ruleTotal: number
  findingCount: number
  failedCount: number
}): RunStatus {
  if (counts.findingCount === 0) return 'failed'
  return counts.failedCount > 0 ? 'partial' : 'completed'
}

export interface SaveRunInput {
  matterId: string
  documentVersionId: string
  layer: TextLayer
  /**
   * The exact prompt version the review ran against, not a slug and an
   * integer.
   *
   * A finding is only interpretable against the exact wording that produced
   * it — "rule 1 says the carve-out must name gross negligence" means
   * nothing once rule 1's statement could have changed. A slug plus a
   * version number is two values someone could edit independently after the
   * fact: the row that used to record `playbook_slug`/`playbook_version`
   * pointed at a version by describing it, not by referencing it, so a
   * playbook edited (or a version renumbered) after a run would silently
   * change what that run appears to have been checked against. A foreign key
   * into `prompt_versions`, an immutable table, cannot be edited out from
   * under the run it describes — the row it names is the row that ran, for
   * as long as the run exists.
   */
  promptVersionId: string
  model: string | null
  result: ReviewResult
  userId: string
  startedAt: string
}

/**
 * Stores the layer, the run, its findings and their verified citations.
 *
 * The text layer goes first and its id is kept on the run, because every stored
 * citation is a pair of offsets into that layer's text — without it they are
 * numbers with nothing to measure against.
 */
export async function saveRun(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveRunInput,
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const sb = client

  const { data: layerRow, error: layerError } = await sb
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
  if (layerError) return { ok: false, message: `Could not store the text layer: ${layerError.message}` }

  const counts = {
    ruleTotal: input.result.findings.length + input.result.failures.length,
    findingCount: input.result.findings.length,
    failedCount: input.result.failures.length,
  }

  const { data: runRow, error: runError } = await sb
    .from('workflow_runs')
    .insert({
      matter_id: input.matterId,
      document_version_id: input.documentVersionId,
      text_layer_id: layerRow.id,
      prompt_version_id: input.promptVersionId,
      kind: 'review',
      model: input.model,
      status: runStatusFor(counts),
      rule_total: counts.ruleTotal,
      finding_count: counts.findingCount,
      failed_count: counts.failedCount,
      failures: input.result.failures,
      started_at: input.startedAt,
      finished_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runError) return { ok: false, message: `Could not store the run: ${runError.message}` }

  const runId = String(runRow.id)

  for (const finding of input.result.findings) {
    const { data: findingRow, error: findingError } = await sb
      .from('workflow_findings')
      .insert({
        run_id: runId,
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
        text_layer_id: layerRow.id,
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
  }

  return { ok: true, runId }
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
  documentVersionId: string
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
}
