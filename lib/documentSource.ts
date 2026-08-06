import type { MatterDocument } from '@/types/database'

export type DocumentSource = MatterDocument['source']

/**
 * Provenance for a newly created document. Written once at creation, never
 * changed, and never used to decide whether a client may see a document —
 * that is `shared_at` alone.
 */
export const DOCUMENT_SOURCES: readonly DocumentSource[] = ['firm', 'client', 'meeting-notes'] as const

export function isDocumentSource(value: unknown): value is DocumentSource {
  return typeof value === 'string' && (DOCUMENT_SOURCES as readonly string[]).includes(value)
}
