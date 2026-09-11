import { createHash } from 'node:crypto'

/** Binds attorney review to the immutable bytes returned by the viewer. */
export function documentReviewRevision(doc: { r2_key: string; current_version_id?: string | null }): string {
  return createHash('sha256').update(JSON.stringify([doc.current_version_id ?? null, doc.r2_key])).digest('hex')
}
