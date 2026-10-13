import { describe, expect, it, vi } from 'vitest'
import { groupDraftHistory, nextUnreviewedDraft, reviewReadthrough, runSelectedConversion } from '@/lib/drafting/reviewWorkflow'

const doc = (id: string, name = 'Trust.docx', created_at = '2026-09-11', reviewedAt: string | null = null) => ({ id, name, created_at, reviewedAt })

describe('review navigation and selected conversion', () => {
  it('groups history by document identity without mixing distinct parties or file types', () => {
    const groups = groupDraftHistory([doc('current')], [doc('old', 'Trust.docx', '2026-09-01'), doc('other', 'Spouse Trust.docx'), doc('pdf', 'Trust.pdf')])
    expect(groups[0].previous.map(d => d.id)).toEqual(['old'])
  })
  it('counts reviewed Word drafts for the read-through', () => {
    expect(reviewReadthrough([
      { name: 'Trust.docx', reviewedAt: '2026-09-12' },
      { name: 'Will.doc', reviewedAt: null },
      { name: 'Trust.pdf', reviewedAt: '2026-09-12' },
    ])).toEqual({ reviewed: 1, total: 2, pct: 50 })
    expect(reviewReadthrough([
      { name: 'Trust.docx', reviewedAt: '2026-09-12' },
      { name: 'Will.docx', reviewedAt: '2026-09-12' },
    ])).toEqual({ reviewed: 2, total: 2, pct: 100 })
    expect(reviewReadthrough([])).toEqual({ reviewed: 0, total: 0, pct: 0 })
  })
  it('walks only unreviewed current Word drafts and wraps', () => {
    const docs = [doc('a'), doc('b', 'Will.docx', '', 'reviewed'), doc('c', 'Proxy.docx'), doc('pdf', 'Trust.pdf')]
    expect(nextUnreviewedDraft(docs, 'a')?.id).toBe('c')
    expect(nextUnreviewedDraft(docs, 'c')?.id).toBe('a')
    expect(nextUnreviewedDraft([doc('a', 'Trust.docx', '', 'reviewed')], 'a')).toBeNull()
  })
  it('converts only the selection and preserves individual failures for retry', async () => {
    const convert = vi.fn(async (d: { id: string }) => { if (d.id === 'b') throw new Error('Worker unavailable') })
    const results = await runSelectedConversion([doc('a'), doc('b'), doc('c')], new Set(['a', 'b']), convert)
    expect(convert.mock.calls.map(([d]) => d.id)).toEqual(['a', 'b'])
    expect(results).toEqual([{ id: 'a', name: 'Trust.docx', status: 'converted' }, { id: 'b', name: 'Trust.docx', status: 'failed', error: 'Worker unavailable' }])
  })
})
