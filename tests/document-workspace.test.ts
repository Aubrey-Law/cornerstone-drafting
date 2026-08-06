import { describe, expect, it } from 'vitest'
import {
  buildDocumentStatusBadges,
  documentFileType,
  isDocumentPdf,
  isDocumentWord,
  isDocumentShared,
} from '@/lib/documentWorkspace'
import type { MatterDocument } from '@/types/database'

function doc(overrides: Partial<MatterDocument>): MatterDocument {
  return {
    id: 'doc-1',
    matter_id: 'matter-1',
    r2_key: 'documents/doc-1',
    name: 'Trust.pdf',
    size: 1024,
    content_type: 'application/pdf',
    shared_at: null,
    source: 'firm',
    uploaded_by: null,
    created_at: '2026-08-06T00:00:00Z',
    ...overrides,
  }
}

describe('document workspace helpers', () => {
  it('detects Word and PDF files', () => {
    expect(isDocumentPdf(doc({ name: 'Plan.pdf' }))).toBe(true)
    expect(isDocumentWord(doc({ name: 'Plan.docx', content_type: 'application/octet-stream' }))).toBe(true)
    expect(documentFileType(doc({ name: 'notes.txt', content_type: 'text/plain' }))).toBe('other')
  })

  it('reads sharing from shared_at alone', () => {
    expect(isDocumentShared(doc({ shared_at: null }))).toBe(false)
    expect(isDocumentShared(doc({ shared_at: '2026-08-06T00:00:00Z' }))).toBe(true)
  })

  it('badges a shared document and a client upload', () => {
    expect(buildDocumentStatusBadges(doc({ shared_at: '2026-08-06T00:00:00Z' })))
      .toContainEqual({ label: 'Shared', tone: 'success' })
    expect(buildDocumentStatusBadges(doc({ source: 'client' })))
      .toContainEqual({ label: 'Client upload', tone: 'info' })
  })

  it('badges marker and missing counts', () => {
    const badges = buildDocumentStatusBadges(doc({ marker_count: 2, missing_count: 1 }))
    expect(badges).toContainEqual({ label: '2 markers', tone: 'danger' })
    expect(badges).toContainEqual({ label: '1 missing', tone: 'warning' })
  })
})
