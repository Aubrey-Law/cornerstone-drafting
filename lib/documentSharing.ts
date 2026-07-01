import { isPdfDocument, isWordDocument } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

/** Folders where the firm shares documents with clients (must be PDF). */
export const FIRM_SHARED_FOLDERS = new Set<MatterDocument['folder']>(['review', 'signed', 'final'])

/** Client-visible folders the firm may publish into (PDF required for Word sources). */
export const FIRM_PUBLISH_FOLDERS = new Set<MatterDocument['folder']>([
  'review',
  'signed',
  'final',
  'intake',
])

export const INTERNAL_WORK_FOLDERS = new Set<MatterDocument['folder']>(['draft', 'meeting-notes'])

export function isFirmSharedFolder(folder: MatterDocument['folder']): boolean {
  return FIRM_SHARED_FOLDERS.has(folder)
}

export function firmPublishRequiresPdf(folder: MatterDocument['folder']): boolean {
  return FIRM_PUBLISH_FOLDERS.has(folder)
}

export function shareableDocumentKind(
  name: string,
  contentType?: string | null,
): 'pdf' | 'word' | 'other' {
  if (isPdfDocument(name, contentType)) return 'pdf'
  if (isWordDocument(name, contentType)) return 'word'
  return 'other'
}

/** Firm documents shown in the client portal must be PDF. */
export function isClientPortalFirmDocument(
  doc: Pick<MatterDocument, 'name' | 'folder'> & { content_type?: string | null },
): boolean {
  if (!isFirmSharedFolder(doc.folder)) return false
  return isPdfDocument(doc.name, doc.content_type)
}

export function wordDocShareBlockReason(
  name: string,
  contentType: string | null | undefined,
  toFolder: MatterDocument['folder'],
): string | null {
  if (!firmPublishRequiresPdf(toFolder)) return null
  if (!isWordDocument(name, contentType)) return null
  return 'Word documents stay internal. Export a PDF from Word, upload it, or use Convert & share PDF.'
}

export function pdfRequiredUploadReason(
  folder: MatterDocument['folder'],
  name: string,
  contentType: string | null | undefined,
): string | null {
  if (!firmPublishRequiresPdf(folder)) return null
  if (isPdfDocument(name, contentType)) return null
  return 'Only PDF files can be shared with clients. Export from Word first, or use Convert & share on an internal draft.'
}
