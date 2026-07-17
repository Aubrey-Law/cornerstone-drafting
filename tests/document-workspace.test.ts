import { describe, expect, it } from 'vitest'
import {
  FIRM_SHARED_FOLDERS,
  buildDocumentStatusBadges,
  buildSelectedDocumentEligibility,
  classifyDocumentVisibility,
  documentFolderLabel,
  getDocumentShareEligibility,
  isDocumentPdf,
  isDocumentWord,
} from '@/lib/documentWorkspace'
import type { MatterDocument } from '@/types/database'

function doc(overrides: Partial<MatterDocument>): MatterDocument {
  return {
    id: overrides.id ?? 'doc-1',
    matter_id: 'matter-1',
    r2_key: 'documents/doc-1',
    name: overrides.name ?? 'Trust.pdf',
    size: 1024,
    content_type: overrides.content_type ?? 'application/pdf',
    folder: overrides.folder ?? 'draft',
    folder_id: null,
    uploaded_by: null,
    created_at: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

describe('document workspace helpers', () => {
  it('labels folders and keeps firm shared folders PDF-only', () => {
    expect(documentFolderLabel('draft')).toBe('Internal draft')
    expect(documentFolderLabel('review')).toBe('Client review PDF')
    expect([...FIRM_SHARED_FOLDERS]).toEqual(['review', 'signed', 'final'])
  })

  it('classifies client and intake as origin folders instead of firm-shared', () => {
    expect(classifyDocumentVisibility(doc({ folder: 'draft' }))).toBe('internal')
    expect(classifyDocumentVisibility(doc({ folder: 'review' }))).toBe('firm-shared')
    expect(classifyDocumentVisibility(doc({ folder: 'client' }))).toBe('client-upload')
    expect(classifyDocumentVisibility(doc({ folder: 'intake' }))).toBe('intake')
  })

  it('wraps Word and PDF detection', () => {
    expect(isDocumentPdf(doc({ name: 'Plan.pdf', content_type: 'application/pdf' }))).toBe(true)
    expect(isDocumentWord(doc({ name: 'Plan.docx', content_type: null as unknown as string }))).toBe(true)
  })

  it('blocks direct Word sharing and generated PDFs that fail the review gate', () => {
    expect(getDocumentShareEligibility(doc({ name: 'Plan.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toMatchObject({
      ok: false,
      code: 'word_document',
    })
    expect(getDocumentShareEligibility(doc({ name: 'Notes.txt', content_type: 'text/plain' }))).toMatchObject({
      ok: false,
      code: 'pdf_required',
    })
    expect(getDocumentShareEligibility(doc({ generation_id: 'gen-1', marker_count: 2, reviewed_at: '2026-07-16T00:00:00Z' }))).toMatchObject({
      ok: false,
      code: 'generated_pdf_has_markers',
    })
    expect(getDocumentShareEligibility(doc({ generation_id: 'gen-1', marker_count: 0, reviewed_at: null }))).toMatchObject({
      ok: false,
      code: 'generated_pdf_not_reviewed',
    })
    expect(getDocumentShareEligibility(doc({ generation_id: 'gen-1', marker_count: 0, reviewed_at: '2026-07-16T00:00:00Z' }))).toEqual({ ok: true })
  })

  it('builds provenance, review, marker, superseded, version, and visibility badge models', () => {
    const badges = buildDocumentStatusBadges(doc({
      generation_id: 'gen-1',
      current_version_id: 'version-1',
      marker_count: 3,
      missing_count: 1,
      reviewed_at: '2026-07-16T00:00:00Z',
      superseded_at: '2026-07-17T00:00:00Z',
      folder: 'review',
    })).map(badge => badge.label)

    expect(badges).toEqual(expect.arrayContaining([
      'Firm shared',
      'Generated',
      'Reviewed',
      '3 markers',
      '1 missing',
      'Superseded',
      'Versioned',
    ]))
  })

  it('separates selected bulk eligibility', () => {
    const selected = [
      doc({ id: 'pdf-1', name: 'Reviewed.pdf', generation_id: 'gen-1', marker_count: 0, reviewed_at: '2026-07-16T00:00:00Z' }),
      doc({ id: 'blocked-1', name: 'Blocked.pdf', generation_id: 'gen-2', marker_count: 1, reviewed_at: '2026-07-16T00:00:00Z' }),
      doc({ id: 'docx-1', name: 'Trust.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      doc({ id: 'docx-2', name: 'Will.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      doc({ id: 'shared-1', name: 'Final.pdf', folder: 'final' }),
    ]

    expect(buildSelectedDocumentEligibility(selected)).toMatchObject({
      shareableIds: ['pdf-1'],
      blockedShareIds: ['blocked-1', 'docx-1', 'docx-2'],
      unshareableIds: ['shared-1'],
      combinableWordIds: ['docx-1', 'docx-2'],
    })
  })
})
