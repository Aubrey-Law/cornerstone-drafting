// Builds the human-facing name for a generated estate-plan draft document:
//   YYYY-MM-DD_Owner Name_Document Title.docx
// where the owner is the person the document belongs to (the client, the
// spouse, or both spouses joined for a joint document). The slug `output` name
// from the generator stays untouched for storage keys and on-disk flows.

// Path separators, reserved filename characters, and control characters are
// replaced with a space so the segment stays readable. Spaces, hyphens, and
// ampersands (used in "Jane & John") are intentionally preserved.
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]+/g

export function sanitizeDraftNameSegment(value: string): string {
  return value.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

export interface BuildDraftDocumentNameArgs {
  /** Generation date as YYYY-MM-DD. */
  date: string
  /** Full name(s) of the person the document belongs to; null when unknown. */
  owner: string | null
  /** Friendly document title, e.g. "Durable Power of Attorney". */
  title: string
}

export function buildDraftDocumentName({ date, owner, title }: BuildDraftDocumentNameArgs): string {
  const segments = [date, owner, title]
    .map(segment => (segment == null ? '' : sanitizeDraftNameSegment(String(segment))))
    .filter(segment => segment.length > 0)
  return `${segments.join('_')}.docx`
}

/** Derive a readable title from a generator slug like `01-durable-power-of-attorney.docx`. */
export function titleFromOutputSlug(slug: string): string {
  const base = slug.replace(/\.docx$/i, '').replace(/^\d+[-_]?/, '')
  const words = base.replace(/[-_]+/g, ' ').trim()
  return words.replace(/\b\w/g, char => char.toUpperCase())
}
