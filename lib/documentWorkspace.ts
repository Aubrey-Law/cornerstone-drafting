import { canPromoteDraft } from '@/lib/drafting/reviewGate'
import { isPdfDocument, isWordDocument } from '@/lib/documents'
import type { MatterDocument } from '@/types/database'

export type DocumentFolder = MatterDocument['folder']

export const DOCUMENT_FOLDERS: Array<{ value: DocumentFolder; label: string; description: string }> = [
  { value: 'draft', label: 'Internal draft', description: 'Attorney work product, hidden from client' },
  { value: 'review', label: 'Client review PDF', description: 'Client-visible review copy' },
  { value: 'final', label: 'Final PDF', description: 'Client-visible final document' },
  { value: 'signed', label: 'Signed PDF', description: 'Client-visible executed document' },
  { value: 'client', label: 'Client upload', description: 'Client-provided document' },
  { value: 'intake', label: 'Intake', description: 'Intake source or support file' },
  { value: 'meeting-notes', label: 'Meeting notes', description: 'Internal meeting notes' },
]

export const FIRM_SHARED_FOLDERS = new Set<DocumentFolder>(['review', 'signed', 'final'])
export const INTERNAL_DOCUMENT_FOLDERS = new Set<DocumentFolder>(['draft', 'meeting-notes'])
export const CLIENT_UPLOAD_FOLDERS = new Set<DocumentFolder>(['client'])
export const INTAKE_DOCUMENT_FOLDERS = new Set<DocumentFolder>(['intake'])
export const DEFAULT_SHARE_FOLDER: DocumentFolder = 'review'
export const DEFAULT_UNSHARE_FOLDER: DocumentFolder = 'draft'

export type DocumentVisibilityKind = 'internal' | 'firm-shared' | 'client-upload' | 'intake'
export type FileTypeFilter = 'all' | 'pdf' | 'word' | 'other'
export type VisibilityFilter = 'all' | DocumentVisibilityKind

export interface DocumentBadgeModel {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}

export type ShareBlockCode =
  | 'already_shared'
  | 'word_document'
  | 'pdf_required'
  | 'generated_pdf_has_markers'
  | 'generated_pdf_not_reviewed'

export type DocumentShareEligibility =
  | { ok: true }
  | { ok: false; code: ShareBlockCode; reason: string }

export interface SelectedDocumentEligibility {
  shareableIds: string[]
  blockedShareIds: string[]
  unshareableIds: string[]
  movableIds: string[]
  combinableWordIds: string[]
  blockedReasons: Record<string, string>
}

export function documentFolderLabel(folder: DocumentFolder) {
  return DOCUMENT_FOLDERS.find(option => option.value === folder)?.label ?? folder
}

export function documentFolderDescription(folder: DocumentFolder) {
  return DOCUMENT_FOLDERS.find(option => option.value === folder)?.description ?? ''
}

export function isDocumentPdf(doc: Pick<MatterDocument, 'name'> & { content_type?: string | null }) {
  return isPdfDocument(doc.name, doc.content_type)
}

export function isDocumentWord(doc: Pick<MatterDocument, 'name'> & { content_type?: string | null }) {
  return isWordDocument(doc.name, doc.content_type)
}

export function documentFileType(doc: Pick<MatterDocument, 'name'> & { content_type?: string | null }): Exclude<FileTypeFilter, 'all'> {
  if (isDocumentPdf(doc)) return 'pdf'
  if (isDocumentWord(doc)) return 'word'
  return 'other'
}

export function classifyDocumentVisibility(doc: Pick<MatterDocument, 'folder'>): DocumentVisibilityKind {
  if (FIRM_SHARED_FOLDERS.has(doc.folder)) return 'firm-shared'
  if (CLIENT_UPLOAD_FOLDERS.has(doc.folder)) return 'client-upload'
  if (INTAKE_DOCUMENT_FOLDERS.has(doc.folder)) return 'intake'
  return 'internal'
}

export function isFirmSharedDocument(doc: Pick<MatterDocument, 'folder'>) {
  return classifyDocumentVisibility(doc) === 'firm-shared'
}

export function getDocumentShareEligibility(doc: MatterDocument): DocumentShareEligibility {
  if (isFirmSharedDocument(doc)) {
    return { ok: false, code: 'already_shared', reason: 'Already shared with the client' }
  }
  if (isDocumentWord(doc)) {
    return {
      ok: false,
      code: 'word_document',
      reason: 'Word documents stay internal. Convert or upload a PDF before sharing.',
    }
  }
  if (!isDocumentPdf(doc)) {
    return {
      ok: false,
      code: 'pdf_required',
      reason: 'Only PDFs can be shared into client-visible firm folders.',
    }
  }
  if (doc.generation_id) {
    const gate = canPromoteDraft({
      markerCount: doc.marker_count ?? null,
      reviewedAt: doc.reviewed_at ?? null,
    })
    if (!gate.ok && gate.reason === 'markers') {
      return {
        ok: false,
        code: 'generated_pdf_has_markers',
        reason: 'Generated PDFs with unresolved markers cannot be shared.',
      }
    }
    if (!gate.ok) {
      return {
        ok: false,
        code: 'generated_pdf_not_reviewed',
        reason: 'Generated PDFs must be marked reviewed before sharing.',
      }
    }
  }
  return { ok: true }
}

export function buildDocumentStatusBadges(doc: MatterDocument): DocumentBadgeModel[] {
  const visibility = classifyDocumentVisibility(doc)
  const badges: DocumentBadgeModel[] = []

  if (visibility === 'firm-shared') badges.push({ label: 'Firm shared', tone: 'success' })
  if (visibility === 'client-upload') badges.push({ label: 'Client upload', tone: 'info' })
  if (visibility === 'intake') badges.push({ label: 'Intake', tone: 'info' })
  if (visibility === 'internal') badges.push({ label: 'Internal', tone: 'neutral' })
  if (doc.generation_id) badges.push({ label: 'Generated', tone: 'info' })
  if (doc.reviewed_at) badges.push({ label: 'Reviewed', tone: 'success' })
  if (typeof doc.marker_count === 'number' && doc.marker_count > 0) {
    badges.push({ label: `${doc.marker_count} marker${doc.marker_count === 1 ? '' : 's'}`, tone: 'danger' })
  }
  if (typeof doc.missing_count === 'number' && doc.missing_count > 0) {
    badges.push({ label: `${doc.missing_count} missing`, tone: 'warning' })
  }
  if (doc.superseded_at) badges.push({ label: 'Superseded', tone: 'warning' })
  if (doc.current_version_id) badges.push({ label: 'Versioned', tone: 'info' })

  return badges
}

export function buildSelectedDocumentEligibility(docs: MatterDocument[]): SelectedDocumentEligibility {
  const shareableIds: string[] = []
  const blockedShareIds: string[] = []
  const unshareableIds: string[] = []
  const movableIds: string[] = []
  const combinableWordIds: string[] = []
  const blockedReasons: Record<string, string> = {}

  for (const doc of docs) {
    movableIds.push(doc.id)
    if (isFirmSharedDocument(doc)) {
      unshareableIds.push(doc.id)
    }
    if (isDocumentWord(doc) && doc.name.toLowerCase().endsWith('.docx')) {
      combinableWordIds.push(doc.id)
    }

    const share = getDocumentShareEligibility(doc)
    if (share.ok) {
      shareableIds.push(doc.id)
    } else if (!isFirmSharedDocument(doc)) {
      blockedShareIds.push(doc.id)
      blockedReasons[doc.id] = share.reason
    }
  }

  return { shareableIds, blockedShareIds, unshareableIds, movableIds, combinableWordIds, blockedReasons }
}
