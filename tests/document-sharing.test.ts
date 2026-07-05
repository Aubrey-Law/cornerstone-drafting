import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  firmPublishRequiresPdf,
  isClientPortalFirmDocument,
  isFirmSharedFolder,
  pdfRequiredUploadReason,
  shareableDocumentKind,
  wordDocShareBlockReason,
} from '@/lib/documentSharing'

describe('documentSharing helpers', () => {
  it('classifies shareable document kinds', () => {
    expect(shareableDocumentKind('Trust.pdf', 'application/pdf')).toBe('pdf')
    expect(shareableDocumentKind('Trust.docx')).toBe('word')
    expect(shareableDocumentKind('notes.txt')).toBe('other')
  })

  it('requires PDF for firm publish folders', () => {
    expect(firmPublishRequiresPdf('review')).toBe(true)
    expect(firmPublishRequiresPdf('signed')).toBe(true)
    expect(firmPublishRequiresPdf('draft')).toBe(false)
    expect(firmPublishRequiresPdf('client')).toBe(false)
  })

  it('blocks Word promotion to client-visible folders', () => {
    expect(wordDocShareBlockReason('Trust.docx', null, 'review')).toMatch(/Word documents stay internal/)
    expect(wordDocShareBlockReason('Trust.pdf', 'application/pdf', 'review')).toBeNull()
    expect(wordDocShareBlockReason('Trust.docx', null, 'draft')).toBeNull()
  })

  it('requires PDF uploads to firm publish folders', () => {
    expect(pdfRequiredUploadReason('review', 'Trust.docx', null)).toMatch(/Only PDF files/)
    expect(pdfRequiredUploadReason('review', 'Trust.pdf', 'application/pdf')).toBeNull()
    expect(pdfRequiredUploadReason('draft', 'Trust.docx', null)).toBeNull()
  })

  it('filters client portal firm documents to PDF only in shared folders', () => {
    expect(isFirmSharedFolder('review')).toBe(true)
    expect(
      isClientPortalFirmDocument({ name: 'Trust.pdf', content_type: 'application/pdf', folder: 'review' }),
    ).toBe(true)
    expect(
      isClientPortalFirmDocument({ name: 'Trust.docx', content_type: null, folder: 'review' }),
    ).toBe(false)
    expect(
      isClientPortalFirmDocument({ name: 'Trust.pdf', content_type: 'application/pdf', folder: 'draft' }),
    ).toBe(false)
  })
})

describe('document sharing route wiring', () => {
  const patchRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/route.ts'),
    'utf8',
  )
  const uploadRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/upload/route.ts'),
    'utf8',
  )

  it('blocks Word promotion in PATCH route', () => {
    expect(patchRoute).toContain('wordDocShareBlockReason')
    expect(patchRoute).toContain("code: 'word_doc_not_shareable'")
  })

  it('requires PDF for admin uploads to share folders', () => {
    expect(uploadRoute).toContain('pdfRequiredUploadReason')
    expect(uploadRoute).toContain("code: 'pdf_required'")
  })
})
