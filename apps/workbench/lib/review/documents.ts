import { extractorFor, type ExtractorKind } from './run'

/**
 * Choosing which of a matter's documents can be reviewed, and in which form.
 *
 * Every draft this firm reviews is its own and already filed, so a review reads
 * a document that exists rather than one uploaded for the occasion. That is
 * what lets a citation anchor to a real `document_versions.id` — the identity
 * the whole citation model depends on, and the thing an ad-hoc upload does not
 * have.
 */
export interface DocumentVersionRow {
  documentId: string
  name: string
  versionId: string
  versionNumber: number
  r2Key: string
  pdfR2Key: string | null
  filename: string | null
  supersededAt: string | null
  deletedAt: string | null
}

export interface CitableSource {
  kind: ExtractorKind
  key: string
}

/**
 * Which stored object to read, and how to extract it.
 *
 * The DOCX wins wherever both exist. In a DOCX a block's index *is* its
 * paragraph index, so a citation becomes a tracked edit by arithmetic; against
 * a PDF rendition it would become one by matching, which is the least reliable
 * link in a chain whose whole value is reliability. The PDF is the fallback.
 */
export function citableFormat(row: DocumentVersionRow): CitableSource | null {
  const sourceKind = extractorFor(row.filename ?? row.name)
  if (sourceKind === 'docx') return { kind: 'docx', key: row.r2Key }
  if (sourceKind === 'pdf') return { kind: 'pdf', key: row.r2Key }
  if (row.pdfR2Key) return { kind: 'pdf', key: row.pdfR2Key }
  return null
}

export interface ReviewableDocument extends DocumentVersionRow {
  source: CitableSource
}

/**
 * The documents on a matter that a review could read.
 *
 * Only the newest version of each: a superseded draft is the one that was
 * replaced, and findings about language nobody will sign are worse than no
 * findings, because nothing in them says which draft they were about.
 */
export function reviewableDocuments(rows: readonly DocumentVersionRow[]): ReviewableDocument[] {
  const newest = new Map<string, ReviewableDocument>()

  for (const row of rows) {
    if (row.supersededAt !== null || row.deletedAt !== null) continue
    const source = citableFormat(row)
    if (!source) continue

    const existing = newest.get(row.documentId)
    if (!existing || row.versionNumber > existing.versionNumber) {
      newest.set(row.documentId, { ...row, source })
    }
  }

  return [...newest.values()].sort((a, b) => a.name.localeCompare(b.name))
}
