import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { toLayer } from './history'
import { loadMatterFacts } from './matterFacts'
import { loadReviewUpload } from './uploads'
import { openRun, openSteps } from '@/lib/runs/record'

/**
 * Reviews a stored upload again — with another playbook, or with the same one
 * once the upload has been linked to a matter.
 *
 * Uses the text layer saved when the upload was first reviewed, not a fresh
 * extraction: the stored bytes have not changed, and citations from every
 * review of the upload then index one layer, so they can be compared.
 *
 * When the upload is linked to a matter, that matter's design-sheet facts are
 * pinned on the run, so rule conditions apply exactly as they do for a filed
 * document. The run itself still carries no `matter_id` — see
 * 20261228090000_review_upload_matter_link.sql for why.
 */

export type QueueUploadReviewResult =
  | { ok: true; runId: string; matterFactsApplied: boolean }
  | { ok: false; status: number; message: string }

export async function queueStoredUploadReview(
  client: SupabaseClient<WorkbenchDatabase>,
  input: { reviewUploadId: string; promptVersionId: string; ruleNumbers: string[]; userId: string },
): Promise<QueueUploadReviewResult> {
  const upload = await loadReviewUpload(client, input.reviewUploadId)
  if (!upload) return { ok: false, status: 404, message: 'That upload no longer exists.' }

  const { data: layerRow, error: layerError } = await client
    .from('document_text_layers')
    .select('id, source_kind, status, extractor, extractor_version, source_sha256, page_count, text, blocks, spans')
    .eq('review_upload_id', upload.id)
    .eq('source_kind', upload.fileKind)
    .maybeSingle()
  if (layerError) return { ok: false, status: 500, message: `Could not load the upload's text: ${layerError.message}` }
  const layer = toLayer(layerRow)
  if (!layerRow || !layer) {
    return { ok: false, status: 409, message: 'This upload has no stored text to review. Upload the file again.' }
  }
  if (layer.status === 'no_text') {
    return { ok: false, status: 422, message: 'This upload has no text layer — it is most likely a scan.' }
  }

  const matterFacts = upload.matterId ? await loadMatterFacts(client, upload.matterId) : null

  const runId = await openRun(client, {
    matterId: null,
    kind: 'review',
    promptVersionId: input.promptVersionId,
    model: null,
    unitTotal: input.ruleNumbers.length,
    userId: input.userId,
    resolvedInputs: matterFacts ? { matterFacts: { ...matterFacts } } : null,
    documentVersionId: null,
    reviewUploadId: upload.id,
    textLayerId: String(layerRow.id),
  })
  await openSteps(client, runId, input.ruleNumbers)
  return { ok: true, runId, matterFactsApplied: matterFacts !== null }
}
