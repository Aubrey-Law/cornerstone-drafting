import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import { storeSnapshot, type RecordingStorage } from '@/lib/addinReview/record'
import type { ScanItem, ScanKind } from './scan'

/**
 * Saving an issue-spotting or proofreading pass to review history.
 *
 * A scan anchors to a snapshot of the document, as a playbook review does
 * (see `lib/addinReview/record.ts`). When it ran with a review, the pane
 * names that review's snapshot and the scan shares it — one copy of the
 * document, one text layer — provided the text is the same text the snapshot
 * stored. A scan on its own sends the document and gets a snapshot of its own.
 *
 * Saving never fails the scan, as with a review: the attorney is watching
 * items arrive and they are worth having unsaved. A failed write stops further
 * writes and is reported to the pane.
 */

type Client = SupabaseClient

export interface StartScanRecordingInput {
  kind: ScanKind
  layer: TextLayer
  model: string | null
  userId: string
  /** The snapshot a review in the same session saved, to share. */
  reviewUploadId: string | null
  /** Or the document itself, for a snapshot of the scan's own. */
  fileBase64: string | null
  documentName: string | null
  matterId: string | null
  sourceDocumentId: string | null
}

export interface ScanRecorder {
  scanId: string
  reviewUploadId: string
  /** Records a section's items. Never throws. */
  recordItems: (items: ScanItem[]) => Promise<void>
  /** Sets the scan's status, counts and failures. Never throws. */
  finish: (result: {
    sections: number
    completed: number
    aborted: boolean
    failures: Array<{ section: number; reason: string }>
  }) => Promise<void>
  problem: () => string | null
}

export type StartScanRecordingResult = { ok: true; recorder: ScanRecorder } | { ok: false; reason: string }

/**
 * The shared snapshot's text layer, when it holds exactly the text this scan
 * read. A document edited between the review and the scan has moved on from
 * the snapshot, and items indexed against it would point at the wrong text.
 */
async function sharedLayer(
  admin: Client,
  reviewUploadId: string,
  layer: TextLayer,
): Promise<{ ok: true; textLayerId: string } | { ok: false; reason: string }> {
  const { data, error } = await admin
    .from('document_text_layers')
    .select('id, text')
    .eq('review_upload_id', reviewUploadId)
    .eq('source_kind', layer.sourceKind)
    .maybeSingle()
  if (error) return { ok: false, reason: `Could not read the review's copy of the document: ${error.message}` }
  if (!data) return { ok: false, reason: 'The review this ran with has no saved copy of the document.' }
  if (data.text !== layer.text) {
    return { ok: false, reason: 'The document changed after the review saved its copy.' }
  }
  return { ok: true, textLayerId: String(data.id) }
}

export async function startScanRecording(
  admin: Client,
  input: StartScanRecordingInput,
  storage?: RecordingStorage,
): Promise<StartScanRecordingResult> {
  let anchor: { reviewUploadId: string; textLayerId: string } | null = null
  let sharedProblem: string | null = null

  if (input.reviewUploadId) {
    const shared = await sharedLayer(admin, input.reviewUploadId, input.layer)
    if (shared.ok) anchor = { reviewUploadId: input.reviewUploadId, textLayerId: shared.textLayerId }
    else sharedProblem = shared.reason
  }
  if (!anchor && input.fileBase64) {
    const snapshot = await storeSnapshot(
      admin,
      {
        fileBase64: input.fileBase64,
        documentName: input.documentName,
        layer: input.layer,
        matterId: input.matterId,
        sourceDocumentId: input.sourceDocumentId,
        userId: input.userId,
      },
      storage,
    )
    if (!snapshot.ok) return snapshot
    anchor = { reviewUploadId: snapshot.reviewUploadId, textLayerId: snapshot.textLayerId }
  }
  if (!anchor) {
    return { ok: false, reason: sharedProblem ?? 'The pane did not send the document, so this check is not saved.' }
  }

  const { data: scanRow, error } = await admin
    .from('document_scans')
    .insert({
      kind: input.kind,
      review_upload_id: anchor.reviewUploadId,
      text_layer_id: anchor.textLayerId,
      model: input.model,
      status: 'running',
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !scanRow) return { ok: false, reason: `Could not save the check: ${error?.message ?? 'no row returned'}` }

  return { ok: true, recorder: createRecorder(admin, String(scanRow.id), anchor.reviewUploadId) }
}

function createRecorder(admin: Client, scanId: string, reviewUploadId: string): ScanRecorder {
  let problem: string | null = null
  let sequence = 0
  let itemCount = 0

  return {
    scanId,
    reviewUploadId,
    problem: () => problem,

    async recordItems(items) {
      if (problem || items.length === 0) return
      const rows = items.map(item => {
        // Only a verified citation is stored, as for a finding.
        const cited = item.citation && item.citation.verification === 'verified' ? item.citation : null
        return {
          scan_id: scanId,
          sequence: sequence++,
          // The id the pane knows the item by, so a decision made in Word can name it.
          item_key: item.id,
          category: item.category,
          importance: item.importance,
          title: item.title,
          explanation: item.explanation,
          replacement: cited ? item.replacement : null,
          block_index: cited?.blockIndex ?? null,
          char_start: cited?.charStart ?? null,
          char_end: cited?.charEnd ?? null,
          quote: cited?.quote ?? null,
          citation_refusal: cited ? null : item.citationRefusal,
          attempted_quote: cited ? null : (item.attemptedQuote ?? item.citation?.quote ?? null),
        }
      })
      try {
        const { error } = await admin.from('document_scan_items').insert(rows)
        if (error) throw new Error(error.message)
        itemCount += rows.length
      } catch (error) {
        problem = `Could not save the check's items: ${error instanceof Error ? error.message : 'unknown error'}`
        console.error('[addin/scan] recording stopped', scanId, problem)
      }
    },

    async finish(result) {
      const status = result.aborted
        ? 'stopped'
        : result.completed === 0
          ? 'failed'
          : result.failures.length > 0 || problem
            ? 'partial'
            : 'completed'
      try {
        const { error } = await admin
          .from('document_scans')
          .update({
            status,
            section_total: result.sections,
            section_completed: result.completed,
            item_count: itemCount,
            failures: result.failures,
            finished_at: new Date().toISOString(),
          })
          .eq('id', scanId)
        if (error) throw new Error(error.message)
      } catch (error) {
        problem ??= `Could not finish saving the check: ${error instanceof Error ? error.message : 'unknown error'}`
        console.error('[addin/scan]', scanId, problem)
      }
    },
  }
}
