import type { SupabaseClient } from '@supabase/supabase-js'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ReviewFinding, ReviewResult } from '@aubrey-law/citations/review/types'

/**
 * Recording a review so it outlives the page.
 *
 * A run is only ever recorded against a *filed* document. An upload has no
 * durable identity, so a saved run about one would carry citations anchored to
 * nothing — which is precisely the failure the citation model exists to avoid.
 * Reviewing an upload stays ephemeral, and the screen says so.
 */
export const WORKFLOW_RUN_COLUMNS = [
  'id',
  'matter_id',
  'document_version_id',
  'text_layer_id',
  'playbook_slug',
  'playbook_version',
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

function untyped(client: SupabaseClient<never>): SupabaseClient {
  return client as unknown as SupabaseClient
}

export interface SaveRunInput {
  matterId: string
  documentVersionId: string
  layer: TextLayer
  playbook: { slug: string; version: number }
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
  client: SupabaseClient<never>,
  input: SaveRunInput,
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const sb = untyped(client)

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
        blocks: input.layer.blocks,
        spans: input.layer.spans,
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
      playbook_slug: input.playbook.slug,
      playbook_version: input.playbook.version,
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
        bbox: finding.citation.bbox,
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
  client: SupabaseClient<never>,
  input: { findingId: string; disposition: Disposition; note: string | null; userId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await untyped(client)
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
  playbookSlug: string
  playbookVersion: number
  status: string
  ruleTotal: number
  failedCount: number
  failures: Array<{ ruleNumber: string; reason: string }>
  finishedAt: string | null
  findings: StoredFinding[]
  layer: TextLayer | null
}
