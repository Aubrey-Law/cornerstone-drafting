import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_FOLDERS,
  buildDocumentStatusBadges,
  documentFileType,
  documentFolderKey,
  documentFolderLabel,
  formatDocumentSize,
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

  it('files every document into at most one derived folder', () => {
    expect(documentFolderKey(doc({ source: 'client' }))).toBe('client-uploads')
    expect(documentFolderKey(doc({ name: 'Chen Trust — SIGNED.pdf' }))).toBe('executed')
    expect(documentFolderKey(doc({ name: 'Notarized deed.pdf' }))).toBe('executed')
    expect(documentFolderKey(doc({ generation_id: 'gen-1' }))).toBe('drafts')
    // An ordinary firm file belongs in no folder and sits loose at the root.
    expect(documentFolderKey(doc({}))).toBeNull()

    // First match wins, so a signed client upload stays with the client.
    expect(documentFolderKey(doc({ source: 'client', name: 'signed.pdf' })))
      .toBe('client-uploads')
    // A generated draft that has since been signed reads as executed.
    expect(documentFolderKey(doc({ generation_id: 'gen-1', name: 'Will executed.docx' })))
      .toBe('executed')
  })

  it('labels every folder key the taxonomy declares', () => {
    for (const folder of DOCUMENT_FOLDERS) {
      expect(documentFolderLabel(folder.key)).toBe(folder.label)
    }
  })

  it('formats byte counts up through gigabytes', () => {
    expect(formatDocumentSize(0)).toBe('—')
    expect(formatDocumentSize(512)).toBe('512 B')
    expect(formatDocumentSize(2048)).toBe('2.0 KB')
    expect(formatDocumentSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatDocumentSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })

  it('badges marker and missing counts', () => {
    const badges = buildDocumentStatusBadges(doc({ marker_count: 2, missing_count: 1 }))
    expect(badges).toContainEqual({ label: '2 markers', tone: 'danger' })
    expect(badges).toContainEqual({ label: '1 missing', tone: 'warning' })
  })
})
