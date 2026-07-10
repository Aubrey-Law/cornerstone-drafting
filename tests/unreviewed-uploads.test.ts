import { describe, expect, it } from 'vitest'
import {
  countUnreviewedFromDocuments,
  formatUnreviewedUploadDetail,
  formatUnreviewedUploadLabel,
  mergeUnreviewedCounts,
} from '@/lib/matter/unreviewedUploads'

describe('unreviewed uploads', () => {
  const docs = [
    { created_at: '2026-01-01T10:00:00.000Z' },
    { created_at: '2026-02-01T10:00:00.000Z' },
    { created_at: '2026-03-01T10:00:00.000Z' },
  ]

  it('counts all docs when never reviewed', () => {
    expect(countUnreviewedFromDocuments(docs, null)).toBe(3)
  })

  it('counts only docs after reviewed timestamp', () => {
    expect(countUnreviewedFromDocuments(docs, '2026-01-15T00:00:00.000Z')).toBe(2)
  })

  it('merges intake and portal totals', () => {
    expect(mergeUnreviewedCounts(2, 1)).toEqual({ intake: 2, portal: 1, total: 3 })
  })

  it('formats mixed upload labels', () => {
    expect(formatUnreviewedUploadLabel(mergeUnreviewedCounts(2, 1))).toBe('3 new uploads')
    expect(formatUnreviewedUploadDetail(mergeUnreviewedCounts(2, 1))).toBe(
      '2 intake questionnaire · 1 portal',
    )
  })

  it('formats single-source labels', () => {
    expect(formatUnreviewedUploadLabel(mergeUnreviewedCounts(0, 1))).toBe('1 portal upload')
    expect(formatUnreviewedUploadLabel(mergeUnreviewedCounts(2, 0))).toBe('2 intake uploads')
  })
})
