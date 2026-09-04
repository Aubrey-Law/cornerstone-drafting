import { buildDocxTextLayer } from '@aubrey-law/citations/textLayer/docx'
import { buildPdfTextLayer } from '@aubrey-law/citations/textLayer/pdf'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import { runReviewPlaybook } from '@aubrey-law/citations/review/runReview'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { ReviewPlaybook, ReviewResult } from '@aubrey-law/citations/review/types'

export type ExtractorKind = 'pdf' | 'docx'

/**
 * Which extractor a filename calls for, or null when the format is not one we
 * can cite from.
 *
 * `.doc` is refused rather than attempted. It is a different format entirely,
 * and a failed parse would read downstream as an empty document — a review with
 * no findings, which looks like a clean draft.
 */
export function extractorFor(filename: string): ExtractorKind | null {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  return null
}

export async function buildLayer(bytes: Buffer, kind: ExtractorKind): Promise<TextLayer> {
  return kind === 'pdf' ? buildPdfTextLayer(bytes) : buildDocxTextLayer(bytes)
}

export interface ReviewLayerOptions {
  callModel: ModelCaller
  model?: string
  userId?: string | null
}

/**
 * Runs a playbook against an already-extracted layer.
 *
 * Separated from extraction so the review path is testable with a hand-built
 * layer and a scripted model — no fixture file, no API key, no network.
 */
export async function reviewLayer(
  layer: TextLayer,
  playbook: ReviewPlaybook,
  options: ReviewLayerOptions,
): Promise<ReviewResult> {
  return runReviewPlaybook(layer, playbook, {
    callModel: options.callModel,
    model: options.model,
    userId: options.userId ?? null,
  })
}

export interface DocumentReview {
  layer: TextLayer
  result: ReviewResult
}

/** Extraction plus review, the shape a route handler needs. */
export async function runDocumentReview(
  bytes: Buffer,
  filename: string,
  playbook: ReviewPlaybook,
  options: ReviewLayerOptions,
): Promise<DocumentReview> {
  const kind = extractorFor(filename)
  if (!kind) {
    throw new Error(`${filename} is not a PDF or a DOCX. Those are the formats a citation can be anchored in.`)
  }
  const layer = await buildLayer(bytes, kind)
  const result = await reviewLayer(layer, playbook, options)
  return { layer, result }
}
