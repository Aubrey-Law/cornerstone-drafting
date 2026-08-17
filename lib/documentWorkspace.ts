import { isPdfDocument, isWordDocument } from '@/lib/documents'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'

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
 * The built-in folders are *derived*, not stored: grouping is computed from the
 * provenance and lifecycle facts a document row already carries, so nothing has
 * to file anything for them to be right.
 *
 * Derivation cannot express "Deed work" or "2026 tax returns", so the attorney
 * can also create named folders (`matter_document_folders`, restored by
 * 20261002000000). Those are stored, and a document carries at most one of
 * them in `folder_id`. A stored folder wins over a derived one — see
 * `documentFolderId`.
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
] as const

export type DocumentFolderKey = (typeof DOCUMENT_FOLDERS)[number]['key']

const EXECUTED_NAME = /\b(signed|executed|notariz\w*|conformed)\b/i

/**
 * The one folder a document belongs to, or `null` when it belongs in none.
 * Ordinary firm files are not a category worth a folder — they sit loose at
 * the root the way a file manager leaves them. First match wins, so a signed
 * client upload files under the client rather than being double-counted.
 */
export function documentFolderKey(
  doc: Pick<MatterDocument, 'name' | 'source'> & { generation_id?: string | null },
): DocumentFolderKey | null {
  if (doc.source === 'client') return 'client-uploads'
  if (EXECUTED_NAME.test(doc.name)) return 'executed'
  if (doc.generation_id) return 'drafts'
  return null
}

export function documentFolderLabel(key: DocumentFolderKey): string {
  return DOCUMENT_FOLDERS.find(folder => folder.key === key)?.label ?? 'Documents'
}

/**
 * A folder as the workspace lists it: either one the attorney created or one
 * derived from the documents themselves. `id` is what the UI keys on and what
 * a move writes; `custom` says which of the two kinds it is.
 */
export interface DocumentFolderView {
  id: string
  label: string
  description: string
  custom: boolean
}

export function customFolderView(folder: MatterDocumentFolder): DocumentFolderView {
  return { id: folder.id, label: folder.name, description: 'Folder you created', custom: true }
}

const DERIVED_FOLDER_VIEWS: DocumentFolderView[] = DOCUMENT_FOLDERS.map(folder => ({
  id: folder.key,
  label: folder.label,
  description: folder.description,
  custom: false,
}))

/**
 * Every folder the root should show, attorney-created ones first — they are
 * the ones somebody deliberately made, and burying them under three fixtures
 * would defeat the point of creating them.
 */
export function documentFolderViews(folders: MatterDocumentFolder[]): DocumentFolderView[] {
  return [
    ...[...folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(customFolderView),
    ...DERIVED_FOLDER_VIEWS,
  ]
}

/**
 * The single folder a document is listed under. An attorney filing a document
 * somewhere is a decision, so it outranks anything derivation would have said —
 * a signed client upload dragged into "Deed work" is in "Deed work".
 */
export function documentFolderId(
  doc: Pick<MatterDocument, 'name' | 'source'> & {
    generation_id?: string | null
    folder_id?: string | null
  },
): string | null {
  return doc.folder_id ?? documentFolderKey(doc)
}

/** The name to show for whichever folder `documentFolderId` returned. */
export function resolveFolderLabel(
  folderId: string,
  folders: MatterDocumentFolder[],
): string {
  const custom = folders.find(folder => folder.id === folderId)
  if (custom) return custom.name
  const derived = DOCUMENT_FOLDERS.find(folder => folder.key === folderId)
  return derived?.label ?? 'Documents'
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
