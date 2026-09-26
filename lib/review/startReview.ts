import type { SupabaseClient } from '@supabase/supabase-js'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { GeneratedDatabase } from '@/types/supabase'
import { loadR2Bytes } from '@/lib/documentApiHelpers'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { openRun, openSteps } from '@/lib/runs/record'
import { pokeTick } from '@/lib/runs/enqueue'
import { loadMatterFacts } from './matterFacts'
import { loadReviewableByMatter, resolveReviewableDocument } from './matterDocuments'
import { saveTextLayer } from './persist'
import { buildLayer, extractorFor, type ExtractorKind } from './run'
import { storeReviewUpload, type UploadStorage } from './uploads'

/**
 * Starting a review from Cornerstone: one published playbook against one
 * document, either filed on a hired matter or uploaded for the purpose (a
 * prior plan). Ported from the workbench's `POST /api/staff/review`.
 *
 * Every review is recorded and queued: the text layer is stored, the run
 * opened with one `pending` step per rule, and the tick works it — the model
 * is never called from this request. A filed document's run carries its
 * matter and pins the design sheet's facts; an upload's belongs to no matter
 * (it can be linked later) and every rule runs.
 *
 * One difference from the workbench: when a review cannot be recorded, it is
 * refused with the reason rather than run inline and shown once unsaved. A
 * review an attorney believes was kept and was not is the failure worth
 * avoiding, and every review started here is one they will want to come back
 * to.
 *
 * The client sends a version id, never a storage key: a key from the browser
 * would be an arbitrary read against the bucket holding every client's
 * documents. The key comes from the database or the request is refused.
 */

export type ReviewSubject =
  | { documentVersionId: string }
  | { upload: { bytes: Buffer; filename: string; label: string } }

export interface StartReviewInput {
  subject: ReviewSubject
  playbookSlug: string
  userId: string
}

export interface StartReviewDependencies {
  read: (key: string) => Promise<Buffer>
  /** Where an upload's bytes are kept; the R2 default in production. */
  uploadStorage?: UploadStorage
}

export type StartReviewResult =
  | { ok: true; runId: string; matterId: string | null; reviewUploadId: string | null; ruleTotal: number }
  | { ok: false; status: 404 | 422 | 500 | 502 | 503; message: string }

const DEFAULTS: StartReviewDependencies = { read: loadR2Bytes }

export async function startReview(
  client: SupabaseClient<GeneratedDatabase>,
  input: StartReviewInput,
  deps: StartReviewDependencies = DEFAULTS,
): Promise<StartReviewResult> {
  const prompt = await loadPublishedPrompt(client, input.playbookSlug)
  if (!prompt || prompt.body.kind !== 'review') {
    return { ok: false, status: 503, message: `No published review playbook named "${input.playbookSlug}".` }
  }
  const ruleNumbers = prompt.body.rules.map(rule => rule.number)

  // What is being reviewed: its bytes, how to read them, and what to anchor to.
  let bytes: Buffer
  let kind: ExtractorKind
  let filed: { documentVersionId: string; matterId: string; name: string } | null = null
  let upload: { bytes: Buffer; filename: string; label: string } | null = null
  if ('documentVersionId' in input.subject) {
    const resolved = resolveReviewableDocument(await loadReviewableByMatter(client), input.subject.documentVersionId)
    if (!resolved) {
      return { ok: false, status: 404, message: 'That document is not one of the current, citable documents on a hired matter.' }
    }
    try {
      bytes = await deps.read(resolved.source.key)
    } catch (error) {
      return {
        ok: false,
        status: 502,
        message: `Could not read ${resolved.name} from storage: ${error instanceof Error ? error.message : 'unknown error'}`,
      }
    }
    // The stored source's own kind, not the name's extension: a document may
    // be citable through its PDF rendition under a name with no extension.
    kind = resolved.source.kind
    filed = { documentVersionId: resolved.versionId, matterId: resolved.matterId, name: resolved.name }
  } else {
    upload = input.subject.upload
    const uploadKind = extractorFor(upload.filename)
    if (!uploadKind) {
      return { ok: false, status: 422, message: `${upload.filename} is not a PDF or a DOCX. Those are the formats a citation can be anchored in.` }
    }
    bytes = upload.bytes
    kind = uploadKind
  }

  let layer: TextLayer
  try {
    layer = await buildLayer(bytes, kind)
  } catch (error) {
    return { ok: false, status: 422, message: error instanceof Error ? error.message : 'The document could not be read.' }
  }
  if (layer.status === 'no_text') {
    return { ok: false, status: 422, message: 'This document has no text layer — it is most likely a scan, which a review cannot cite.' }
  }

  try {
    let runId: string
    let reviewUploadId: string | null = null
    if (filed) {
      const saved = await saveTextLayer(client, { documentVersionId: filed.documentVersionId, layer })
      if (!saved.ok) return { ok: false, status: 500, message: saved.message }
      // Pinned with the run, so conditions are tested against the sheet as it
      // stood when the review opened — including on retry.
      const matterFacts = await loadMatterFacts(client, filed.matterId)
      runId = await openRun(client, {
        matterId: filed.matterId,
        kind: 'review',
        promptVersionId: prompt.versionId,
        model: null,
        unitTotal: ruleNumbers.length,
        userId: input.userId,
        resolvedInputs: matterFacts ? { matterFacts: { ...matterFacts } } : null,
        documentVersionId: filed.documentVersionId,
        textLayerId: saved.layerId,
      })
    } else if (upload) {
      // An undefined storage takes `storeReviewUpload`'s R2 default.
      const stored = await storeReviewUpload(
        client,
        { bytes, filename: upload.filename, kind, label: upload.label, userId: input.userId },
        deps.uploadStorage,
      )
      if (!stored.ok) return { ok: false, status: 500, message: stored.message }
      reviewUploadId = stored.reviewUploadId
      const saved = await saveTextLayer(client, { reviewUploadId, layer })
      if (!saved.ok) return { ok: false, status: 500, message: saved.message }
      runId = await openRun(client, {
        matterId: null,
        kind: 'review',
        promptVersionId: prompt.versionId,
        model: null,
        unitTotal: ruleNumbers.length,
        userId: input.userId,
        resolvedInputs: null,
        documentVersionId: null,
        reviewUploadId,
        textLayerId: saved.layerId,
      })
    } else {
      return { ok: false, status: 422, message: 'Choose a document to review.' }
    }

    await openSteps(client, runId, ruleNumbers)
    await pokeTick()
    return { ok: true, runId, matterId: filed?.matterId ?? null, reviewUploadId, ruleTotal: ruleNumbers.length }
  } catch (error) {
    return { ok: false, status: 500, message: error instanceof Error ? error.message : 'The review could not be recorded.' }
  }
}
