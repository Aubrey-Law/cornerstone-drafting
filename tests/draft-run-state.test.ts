import { describe, expect, it } from 'vitest'
import { sourceRevision, runRequestHash, summarizeRun, outstandingDocuments } from '@/lib/drafting/runState'
describe('draft run identity and outcomes', () => {
  it('binds identity to values rather than property order', () => {
    expect(sourceRevision({ a: 1, b: { d: 2, c: 3 } })).toBe(sourceRevision({ b: { c: 3, d: 2 }, a: 1 }))
    expect(sourceRevision({ a: 1 })).not.toBe(sourceRevision({ a: 2 }))
  })
  it('deduplicates and orders document selection for retries', () => {
    expect(runRequestHash('rev', ['will', 'trust', 'will'])).toBe(runRequestHash('rev', ['trust', 'will']))
    expect(runRequestHash('rev2', ['trust'])).not.toBe(runRequestHash('rev', ['trust']))
  })
  it('retries only files not already saved and reports partial failure', () => {
    const outcomes = [{ filename: 'trust', name: 'Trust', documentId: '1', status: 'saved' as const }, { filename: 'will', name: 'Will', status: 'failed' as const, error: 'Upload failed' }]
    expect(outstandingDocuments(['trust', 'will', 'hcp'], outcomes)).toEqual(['will', 'hcp'])
    expect(summarizeRun(['trust', 'will', 'hcp'], outcomes)).toEqual({ saved: 1, failed: 1, pending: 1, total: 3, status: 'partial' })
    expect(summarizeRun(['trust'], outcomes.slice(0, 1)).status).toBe('completed')
  })
})
