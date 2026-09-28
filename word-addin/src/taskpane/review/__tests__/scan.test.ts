import { describe, expect, it } from 'vitest'
import {
  applyScanEvent,
  categoriesOf,
  EMPTY_SCAN,
  filterItems,
  itemActions,
  scanCommentText,
  scanReplacements,
  tallyImportance,
  type ScanItem,
} from '../scan'

const verified = (blockIndex: number, quote: string) => ({ blockIndex, quote, verification: 'verified' as const })

const item = (over: Partial<ScanItem>): ScanItem => ({
  id: 'proofread-0-0',
  category: 'Spelling & grammar',
  importance: 'notable',
  title: 'Pronoun case',
  explanation: '“between you and I” should be “me”.',
  replacement: null,
  citation: null,
  citationRefusal: null,
  attemptedQuote: null,
  ...over,
})

const ITEMS = [
  item({ id: 'a', importance: 'minor', category: 'Punctuation & formatting', title: 'Space before comma', citation: verified(9, 'Trustee ,') }),
  item({ id: 'b', importance: 'important', category: 'Internal annotations', title: 'TBD successor trustee', citation: verified(4, '[TBD]'), replacement: 'Avideep Chawla' }),
  item({ id: 'c', importance: 'notable', title: 'Pronoun case', citation: verified(2, 'you and I'), replacement: 'you and me' }),
  item({ id: 'd', importance: 'important', category: 'Internal annotations', title: 'Drafting note left in', attemptedQuote: 'NOTE TO SELF' }),
]

describe('applyScanEvent', () => {
  it('builds a pass from the stream, and records sections that did not run', () => {
    let state = applyScanEvent(EMPTY_SCAN, { start: true, kind: 'proofread' })
    state = applyScanEvent(state, { items: ITEMS.slice(0, 2) })
    state = applyScanEvent(state, { failure: { section: 2, reason: 'timeout' } })
    state = applyScanEvent(state, { items: ITEMS.slice(2) })
    state = applyScanEvent(state, { done: true, sections: 3, completed: 2, aborted: false })
    expect(state).toMatchObject({ started: true, done: true, sections: 3, failures: [{ section: 2, reason: 'timeout' }] })
    expect(state.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps whether the pass is saved, and a save that stopped part-way', () => {
    let state = applyScanEvent(EMPTY_SCAN, { start: true, kind: 'issues', recording: { saved: true, scanId: 's1', reviewUploadId: 'u1' } })
    expect(state.recording).toEqual({ saved: true, scanId: 's1', reviewUploadId: 'u1' })
    state = applyScanEvent(state, { done: true, sections: 1, completed: 1, aborted: false, recordingProblem: 'disk full' })
    expect(state.recordingProblem).toBe('disk full')
    // An older server sends no recording at all: that is "unknown", not "saved".
    expect(applyScanEvent(EMPTY_SCAN, { start: true, kind: 'issues' }).recording).toBeNull()
  })

  it('treats an error frame as the end of the pass', () => {
    expect(applyScanEvent({ ...EMPTY_SCAN, started: true }, { error: 'boom' })).toMatchObject({ done: true, error: 'boom' })
  })
})

describe('the report', () => {
  it('counts by importance and offers only the categories present', () => {
    expect(tallyImportance(ITEMS)).toEqual({ important: 2, notable: 1, minor: 1 })
    expect(categoriesOf(ITEMS)).toEqual(['Internal annotations', 'Punctuation & formatting', 'Spelling & grammar'])
  })

  it('sorts by importance or by place in the document, unplaced items last', () => {
    const all = { category: 'all', importance: 'all', query: '' } as const
    expect(filterItems(ITEMS, { ...all, sort: 'importance' }).map((i) => i.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(filterItems(ITEMS, { ...all, sort: 'document' }).map((i) => i.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('filters by category, importance and text', () => {
    expect(filterItems(ITEMS, { category: 'Internal annotations', importance: 'all', query: '', sort: 'importance' }).map((i) => i.id)).toEqual(['b', 'd'])
    expect(filterItems(ITEMS, { category: 'all', importance: 'minor', query: '', sort: 'importance' }).map((i) => i.id)).toEqual(['a'])
    expect(filterItems(ITEMS, { category: 'all', importance: 'all', query: 'tbd', sort: 'importance' }).map((i) => i.id)).toEqual(['b'])
  })
})

describe('what an item may do', () => {
  it('marks up the document only from a verified quote', () => {
    expect(itemActions(ITEMS[1])).toEqual({ reveal: true, comment: true, replace: 'Avideep Chawla' })
    expect(itemActions(ITEMS[3])).toEqual({ reveal: false, comment: false, replace: null })
    expect(itemActions(item({ replacement: 'x', citation: { ...verified(1, 'y'), verification: 'unverified' } })).replace).toBeNull()
  })

  it('bulk-applies verified replacements, most important first', () => {
    expect(scanReplacements(ITEMS).map((r) => [r.item.id, r.text])).toEqual([
      ['b', 'Avideep Chawla'],
      ['c', 'you and me'],
    ])
  })

  it('writes a comment that says where it came from', () => {
    expect(scanCommentText('proofread', ITEMS[2])).toBe(
      'Cornerstone proofread — Spelling & grammar (notable)\nPronoun case\n\n“between you and I” should be “me”.\n\nSuggested: you and me',
    )
  })
})
