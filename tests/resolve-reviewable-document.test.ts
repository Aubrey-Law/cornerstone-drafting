import { describe, expect, it } from 'vitest'
import { resolveReviewableDocument, type MatterDocuments } from '@/lib/review/matterDocuments'

const matters = (versionId = 'v-1'): MatterDocuments[] => [
  {
    matterId: 'm-1',
    title: 'Smith Revocable Trust',
    documents: [
      {
        documentId: 'd-1',
        name: 'Trust.docx',
        versionId,
        versionNumber: 2,
        r2Key: 'matters/m-1/trust.docx',
        pdfR2Key: null,
        filename: 'Trust.docx',
        supersededAt: null,
        deletedAt: null,
        source: { kind: 'docx', key: 'matters/m-1/trust.docx' },
      },
    ],
  },
]

/**
 * The security property this function exists to hold: a review is asked for by
 * version id, and the storage key is looked up here. A key accepted from the
 * browser would be an arbitrary read against the bucket holding every client's
 * documents — a different and far worse thing than a review.
 *
 * Pure, so the property is asserted directly rather than through a mocked
 * database, and the list it searches is the same one the screen offered.
 */
describe('resolveReviewableDocument', () => {
  it('turns a version id into the object to read', () => {
    expect(resolveReviewableDocument(matters(), 'v-1')).toMatchObject({
      versionId: 'v-1',
      documentId: 'd-1',
      matterId: 'm-1',
      source: { kind: 'docx', key: 'matters/m-1/trust.docx' },
    })
  })

  it('refuses a version id that is not among the reviewable documents', () => {
    // Superseded, deleted, an uncitable format or simply invented: all refused
    // the same way, because the only path to a key is through this list.
    expect(resolveReviewableDocument(matters(), 'v-invented')).toBeNull()
  })

  it('refuses when the matter has nothing reviewable', () => {
    expect(resolveReviewableDocument([], 'v-1')).toBeNull()
  })

  it('carries the matter through, so a saved run knows what it was about', () => {
    expect(resolveReviewableDocument(matters(), 'v-1')?.matterId).toBe('m-1')
  })
})
