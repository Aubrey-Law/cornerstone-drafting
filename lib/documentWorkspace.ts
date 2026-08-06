import { isPdfDocument, isWordDocument } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export type FileTypeFilter = 'all' | 'pdf' | 'word' | 'other'

export interface DocumentBadgeModel {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

type DocFile = Pick<MatterDocument, 'name'> & { content_type?: string | null }

export function isDocumentPdf(doc: DocFile) {
  return isPdfDocument(doc.name, doc.content_type)
}

export function isDocumentWord(doc: DocFile) {
  return isWordDocument(doc.name, doc.content_type)
}

export function documentFileType(doc: DocFile): Exclude<FileTypeFilter, 'all'> {
  if (isDocumentPdf(doc)) return 'pdf'
  if (isDocumentWord(doc)) return 'word'
  return 'other'
}

/** The whole visibility rule. */
export function isDocumentShared(doc: Pick<MatterDocument, 'shared_at'>) {
  return doc.shared_at !== null
}

export function buildDocumentStatusBadges(doc: MatterDocument): DocumentBadgeModel[] {
  const badges: DocumentBadgeModel[] = []

  if (isDocumentShared(doc)) badges.push({ label: 'Shared', tone: 'success' })
  if (doc.source === 'client') badges.push({ label: 'Client upload', tone: 'info' })
  if (doc.generation_id) badges.push({ label: 'Generated', tone: 'info' })
  if (doc.reviewed_at) badges.push({ label: 'Reviewed', tone: 'success' })
  if (typeof doc.marker_count === 'number' && doc.marker_count > 0) {
    badges.push({ label: `${doc.marker_count} marker${doc.marker_count === 1 ? '' : 's'}`, tone: 'danger' })
  }
  if (typeof doc.missing_count === 'number' && doc.missing_count > 0) {
    badges.push({ label: `${doc.missing_count} missing`, tone: 'warning' })
  }
  if (doc.superseded_at) badges.push({ label: 'Superseded', tone: 'warning' })

  return badges
}
