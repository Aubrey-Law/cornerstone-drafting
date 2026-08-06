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

/**
 * File-manager folders are *derived*, not stored. `matter_documents` has no
 * folder column — it was dropped once it turned out nothing ever populated it
 * (20260806135231_drop_document_folders) — so grouping is computed from the
 * provenance and lifecycle facts the row already carries. Nothing here writes.
 */
export const DOCUMENT_FOLDERS = [
  {
    key: 'client-uploads',
    label: 'From client',
    description: 'Files the client sent through the portal or intake',
  },
  {
    key: 'executed',
    label: 'Signed & executed',
    description: 'Signed, executed, and notarized copies',
  },
  {
    key: 'drafts',
    label: 'Generated drafts',
    description: 'Output of the drafting engine',
  },
  {
    key: 'firm-files',
    label: 'Firm files',
    description: 'Everything else filed by the firm',
  },
] as const

export type DocumentFolderKey = (typeof DOCUMENT_FOLDERS)[number]['key']

const EXECUTED_NAME = /\b(signed|executed|notariz\w*|conformed)\b/i

/**
 * The one folder a document belongs to. First match wins, so a signed client
 * upload files under the client rather than being double-counted.
 */
export function documentFolderKey(
  doc: Pick<MatterDocument, 'name' | 'source'> & { generation_id?: string | null },
): DocumentFolderKey {
  if (doc.source === 'client') return 'client-uploads'
  if (EXECUTED_NAME.test(doc.name)) return 'executed'
  if (doc.generation_id) return 'drafts'
  return 'firm-files'
}

export function documentFolderLabel(key: DocumentFolderKey): string {
  return DOCUMENT_FOLDERS.find(folder => folder.key === key)?.label ?? 'Firm files'
}

/** Byte counts as a file manager shows them. */
export function formatDocumentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
