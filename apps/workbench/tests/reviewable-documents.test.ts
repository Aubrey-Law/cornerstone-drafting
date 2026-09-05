import { describe, expect, it } from 'vitest'
import { citableFormat, reviewableDocuments } from '@/lib/review/documents'

const row = (over: Partial<Parameters<typeof reviewableDocuments>[0][number]> = {}) => ({
  documentId: 'd-1',
  name: 'Smith Revocable Trust.docx',
  versionId: 'v-1',
  versionNumber: 1,
  r2Key: 'matters/m-1/trust.docx',
  pdfR2Key: null,
  filename: 'Smith Revocable Trust.docx',
  supersededAt: null,
  deletedAt: null,
  ...over,
})

describe('citableFormat', () => {
  /**
   * A DOCX is preferred over its PDF rendition wherever both exist. In a DOCX a
   * block's index *is* its paragraph index, so citation to tracked edit is
   * arithmetic; against a PDF it would be a match. The PDF is the fallback, not
   * the default.
   */
  it('prefers the DOCX even when a PDF rendition exists', () => {
    expect(citableFormat(row({ pdfR2Key: 'matters/m-1/trust.pdf' }))).toMatchObject({
      kind: 'docx',
      key: 'matters/m-1/trust.docx',
    })
  })

  it('falls back to the PDF when the source is not a DOCX', () => {
    expect(
      citableFormat(row({ name: 'Scan.pdf', r2Key: 'matters/m-1/scan.pdf', filename: 'Scan.pdf' })),
    ).toMatchObject({ kind: 'pdf', key: 'matters/m-1/scan.pdf' })
  })

  it('uses the rendition when the source is neither', () => {
    expect(
      citableFormat(row({ name: 'Notes.txt', r2Key: 'k.txt', filename: 'Notes.txt', pdfR2Key: 'k.pdf' })),
    ).toMatchObject({ kind: 'pdf', key: 'k.pdf' })
  })

  it('has nothing to offer for a format no citation can anchor in', () => {
    expect(citableFormat(row({ name: 'Photo.jpg', r2Key: 'k.jpg', filename: 'Photo.jpg' }))).toBeNull()
  })
})

describe('reviewableDocuments', () => {
  it('offers a current document', () => {
    expect(reviewableDocuments([row()])).toHaveLength(1)
  })

  /**
   * A superseded version is the draft that was replaced. Reviewing it would
   * produce findings about language nobody will sign, and — worse — the
   * attorney would have no way to tell from the findings which draft they were
   * about.
   */
  it('leaves out a superseded document', () => {
    expect(reviewableDocuments([row({ supersededAt: '2026-09-01T00:00:00Z' })])).toEqual([])
  })

  it('leaves out a deleted version', () => {
    expect(reviewableDocuments([row({ deletedAt: '2026-09-01T00:00:00Z' })])).toEqual([])
  })

  it('leaves out a format nothing can be cited in', () => {
    expect(reviewableDocuments([row({ name: 'Photo.jpg', r2Key: 'k.jpg', filename: 'Photo.jpg' })])).toEqual([])
  })

  it('keeps only the newest version of a document', () => {
    const documents = reviewableDocuments([
      row({ versionId: 'v-1', versionNumber: 1 }),
      row({ versionId: 'v-3', versionNumber: 3 }),
      row({ versionId: 'v-2', versionNumber: 2 }),
    ])
    expect(documents).toHaveLength(1)
    expect(documents[0].versionId).toBe('v-3')
  })

  it('keeps separate documents apart', () => {
    const documents = reviewableDocuments([
      row({ documentId: 'd-1', versionId: 'v-1' }),
      row({ documentId: 'd-2', versionId: 'v-9', name: 'Pour-Over Will.docx', filename: 'Pour-Over Will.docx' }),
    ])
    expect(documents.map((d) => d.documentId).sort()).toEqual(['d-1', 'd-2'])
  })

  it('names each one the way it appears in the file', () => {
    expect(reviewableDocuments([row()])[0].name).toBe('Smith Revocable Trust.docx')
  })

  it('has nothing to offer for a matter with no documents', () => {
    expect(reviewableDocuments([])).toEqual([])
  })
})
