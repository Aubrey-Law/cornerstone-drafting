import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CURRENT_REVIEW_RENDER_VERSION } from '@aubrey-law/citations/review/runReview'
import type { MatterFacts } from '@aubrey-law/citations/review/conditions'
import type { ReviewFinding, ReviewRule } from '@aubrey-law/citations/review/types'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import { MAX_UPLOAD_BYTES, putFileToR2 } from '@/lib/documentUpload'
import { deleteR2Key } from '@/lib/r2Delete'

/**
 * Recording a review run from the Word add-in, so it outlives the pane.
 *
 * Written in exactly the shape the workbench records a review of an unfiled
 * upload (`apps/workbench/lib/review/persist.ts`, `lib/runs/record.ts`), so its
 * history, saved-review page and worker read it with no change:
 *
 *  1. A snapshot: the .docx as it was in Word, stored under `review-uploads/`
 *     as a `review_uploads` row with `origin: 'word'`, linked to the pane's
 *     matter when it has one. See 20261230090000_review_upload_origin.sql for
 *     why a snapshot and not the linked document's version.
 *  2. The paragraph text layer the pane sent, which every citation indexes.
 *  3. A `review` run, `running` from the start because this request is working
 *     it, with one `pending` step per rule.
 *  4. Each rule's finding, verified citation and step as it settles.
 *  5. The run's status and counts at the end.
 *
 * Recording never fails the review: the attorney is watching findings arrive
 * and they are worth having unrecorded. A failure stops further writes and is
 * reported to the pane instead. A run left `running` by a request that died
 * has its heartbeat go stale, and the workbench's reaper hands it back to the
 * queue; a run the attorney stopped part-way is queued at once. Either way the
 * tick works only the steps still `pending`, against this same stored layer.
 */

type Client = SupabaseClient

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface RecordingStorage {
  write: (key: string, bytes: Buffer, contentType: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

const R2_STORAGE: RecordingStorage = { write: putFileToR2, remove: deleteR2Key }

export interface StartRecordingInput {
  /** The open document's bytes, as `Office.context.document.getFileAsync` gives them. */
  fileBase64: string
  /** What the pane calls the document; becomes the snapshot's label. */
  documentName: string | null
  layer: TextLayer
  playbook: { versionId: string; rules: ReviewRule[] }
  model: string | null
  /** The matter the pane is linked to, if any: the snapshot is linked to it, and its facts pinned. */
  matterId: string | null
  matterFacts: MatterFacts | null
  /** The Cornerstone document the Word file was opened from, if the pane knows it. */
  sourceDocumentId: string | null
  userId: string
}

export type RuleOutcome = { findings: ReviewFinding[]; failures: Array<{ ruleNumber: string; reason: string }> }

export interface ReviewRecorder {
  runId: string
  reviewUploadId: string
  /** Records one rule as it settles. Never throws. */
  recordRule: (rule: ReviewRule, sequence: number, outcome: RuleOutcome) => Promise<void>
  /** Sets the run's status and counts. `aborted` leaves the unsettled rules to the queue. Never throws. */
  finish: (aborted: boolean) => Promise<void>
  /** Null while every write has succeeded; otherwise why recording stopped. */
  problem: () => string | null
}

export type StartRecordingResult = { ok: true; recorder: ReviewRecorder } | { ok: false; reason: string }

/** A label for the snapshot: the pane's name for the document, or a dated fallback. */
export function snapshotLabel(documentName: string | null, now: Date = new Date()): string {
  const name = documentName?.trim().replace(/\s+/g, ' ').replace(/\.docx$/i, '').slice(0, 200)
  return name || `Word document reviewed ${now.toISOString().slice(0, 10)}`
}

function snapshotFilename(label: string): string {
  const safe = label.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-120)
  return `${safe || 'document'}.docx`
}

function decodeDocx(fileBase64: string): Buffer | null {
  const bytes = Buffer.from(fileBase64, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null
  // Every .docx is a zip; anything else is not the document Word has open.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null
  return bytes
}

export async function startReviewRecording(
  admin: Client,
  input: StartRecordingInput,
  storage: RecordingStorage = R2_STORAGE,
): Promise<StartRecordingResult> {
  const bytes = decodeDocx(input.fileBase64)
  if (!bytes) return { ok: false, reason: 'The document could not be read from Word to keep a copy.' }

  const label = snapshotLabel(input.documentName)
  const filename = snapshotFilename(label)
  const key = `review-uploads/${crypto.randomUUID()}/${filename}`
  try {
    await storage.write(key, bytes, DOCX_CONTENT_TYPE)
  } catch (error) {
    return { ok: false, reason: `Could not keep a copy of the document: ${error instanceof Error ? error.message : 'storage error'}` }
  }

  const now = new Date().toISOString()
  const { data: upload, error: uploadError } = await admin
    .from('review_uploads')
    .insert({
      label,
      filename,
      file_kind: 'docx',
      r2_key: key,
      size_bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      created_by: input.userId,
      origin: 'word',
      source_document_id: input.sourceDocumentId,
      matter_id: input.matterId,
      linked_at: input.matterId ? now : null,
      linked_by: input.matterId ? input.userId : null,
    })
    .select('id')
    .single()
  if (uploadError || !upload) {
    await storage.remove(key)
    return { ok: false, reason: `Could not record the review: ${uploadError?.message ?? 'no row returned'}` }
  }
  const reviewUploadId = String(upload.id)

  const { data: layerRow, error: layerError } = await admin
    .from('document_text_layers')
    .insert({
      document_version_id: null,
      review_upload_id: reviewUploadId,
      source_kind: input.layer.sourceKind,
      status: input.layer.status,
      extractor: input.layer.extractor,
      extractor_version: input.layer.extractorVersion,
      source_sha256: input.layer.sourceSha256,
      page_count: input.layer.pageCount,
      text: input.layer.text,
      blocks: input.layer.blocks,
      spans: input.layer.spans,
    })
    .select('id')
    .single()
  if (layerError || !layerRow) {
    return { ok: false, reason: `Could not store the document text: ${layerError?.message ?? 'no row returned'}` }
  }
  const textLayerId = String(layerRow.id)

  const { data: runRow, error: runError } = await admin
    .from('workflow_runs')
    .insert({
      // The link lives on the snapshot, never the run: see
      // 20261228090000_review_upload_matter_link.sql on the run advisory.
      matter_id: null,
      document_version_id: null,
      review_upload_id: reviewUploadId,
      text_layer_id: textLayerId,
      prompt_version_id: input.playbook.versionId,
      kind: 'review',
      model: input.model,
      // This request is working it; a tick must not claim it too.
      status: 'running',
      rule_total: input.playbook.rules.length,
      finding_count: 0,
      failed_count: 0,
      // Pinned so a queued remainder applies the same conditions this run did.
      resolved_inputs: input.matterFacts ? { matterFacts: input.matterFacts } : null,
      render_version: CURRENT_REVIEW_RENDER_VERSION,
      started_at: now,
      finished_at: null,
      last_tick_at: now,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runError || !runRow) {
    return { ok: false, reason: `Could not record the review: ${runError?.message ?? 'no row returned'}` }
  }
  const runId = String(runRow.id)

  for (let sequence = 0; sequence < input.playbook.rules.length; sequence += 1) {
    const { error } = await admin.from('workflow_run_steps').insert({
      run_id: runId,
      unit_id: input.playbook.rules[sequence].number,
      sequence,
      status: 'pending',
      attempts: 0,
      last_error: null,
      started_at: null,
      finished_at: null,
    })
    if (error) return { ok: false, reason: `Could not record the review's rules: ${error.message}` }
  }

  return { ok: true, recorder: createRecorder(admin, { runId, reviewUploadId, textLayerId }) }
}

function createRecorder(
  admin: Client,
  ids: { runId: string; reviewUploadId: string; textLayerId: string },
): ReviewRecorder {
  let problem: string | null = null
  let succeeded = 0
  let failed = 0
  const failures: Array<{ ruleNumber: string; reason: string }> = []

  const must = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message}`)
  }

  const writeRule = async (rule: ReviewRule, sequence: number, outcome: RuleOutcome) => {
    const finding = outcome.findings.find(candidate => candidate.ruleNumber === rule.number) ?? null
    let findingId: string | null = null

    if (finding) {
      const { data: findingRow, error: findingError } = await admin
        .from('workflow_findings')
        .insert({
          run_id: ids.runId,
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
      must(findingError, 'Could not store a finding')
      findingId = String(findingRow!.id)

      // Only a verified citation is stored, as in the workbench.
      if (finding.citation && finding.citation.verification === 'verified') {
        const { error: citationError } = await admin.from('workflow_citations').insert({
          finding_id: findingId,
          text_layer_id: ids.textLayerId,
          document_version_id: null,
          review_upload_id: ids.reviewUploadId,
          block_index: finding.citation.blockIndex,
          char_start: finding.citation.charStart,
          char_end: finding.citation.charEnd,
          page: finding.citation.page,
          bbox: finding.citation.bbox,
          quote: finding.citation.quote,
          verification: finding.citation.verification,
        })
        must(citationError, 'Could not store a citation')
      }
    }

    const failure = finding
      ? null
      : (outcome.failures.find(candidate => candidate.ruleNumber === rule.number) ?? {
          ruleNumber: rule.number,
          reason: 'The rule produced no answer.',
        })
    const settledAt = new Date().toISOString()
    const { error: stepError } = await admin.from('workflow_run_steps').upsert(
      {
        run_id: ids.runId,
        unit_id: rule.number,
        sequence,
        status: failure ? 'failed' : 'succeeded',
        attempts: 1,
        last_error: failure?.reason ?? null,
        finding_id: findingId,
        started_at: settledAt,
        finished_at: settledAt,
      },
      { onConflict: 'run_id,unit_id' },
    )
    must(stepError, 'Could not record a rule')

    const { error: tickError } = await admin
      .from('workflow_runs')
      .update({ last_tick_at: settledAt })
      .eq('id', ids.runId)
    must(tickError, "Could not stamp the run's heartbeat")

    if (failure) {
      failed += 1
      failures.push(failure)
    } else {
      succeeded += 1
    }
  }

  return {
    runId: ids.runId,
    reviewUploadId: ids.reviewUploadId,
    problem: () => problem,

    async recordRule(rule, sequence, outcome) {
      if (problem) return
      try {
        await writeRule(rule, sequence, outcome)
      } catch (error) {
        problem = error instanceof Error ? error.message : 'Recording failed.'
        console.error('[addin/review] recording stopped', ids.runId, problem)
      }
    },

    async finish(aborted) {
      // A write that failed leaves its step pending: the reaper hands the run
      // back once the heartbeat goes stale, and the tick finishes it.
      if (problem) return
      const settled = succeeded + failed
      const status = aborted
        ? 'queued'
        : settled === 0 || succeeded === 0
          ? 'failed'
          : failed === 0
            ? 'completed'
            : 'partial'
      try {
        const { error } = await admin
          .from('workflow_runs')
          .update({
            status,
            finding_count: succeeded,
            failed_count: failed,
            failures,
            // A queued remainder is not finished, and a tick claims it afresh.
            finished_at: aborted ? null : new Date().toISOString(),
            last_tick_at: aborted ? null : new Date().toISOString(),
          })
          .eq('id', ids.runId)
        if (error) throw new Error(error.message)
      } catch (error) {
        problem = `Could not finish recording the review: ${error instanceof Error ? error.message : 'unknown error'}`
        console.error('[addin/review]', ids.runId, problem)
      }
    },
  }
}
