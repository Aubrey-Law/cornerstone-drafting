import { describe, expect, it } from 'vitest'
import { orderFindings, isCitable } from '@/lib/review/order'
import type { ReviewFinding } from '@aubrey-law/citations/review/types'

const finding = (over: Partial<ReviewFinding> & { ruleNumber: string }): ReviewFinding => ({
  outcome: 'deviation',
  severity: 'medium',
  rationale: 'because',
  proposedLanguage: null,
  citation: null,
  citationRefusal: null,
  attemptedQuote: null,
  ...over,
})

/**
 * The order findings are read in is the order the attorney works in, so it is
 * a product decision rather than presentation: what must be dealt with before
 * the document can go anywhere comes first.
 */
describe('orderFindings', () => {
  it('puts what the document gets wrong above what it gets right', () => {
    const ordered = orderFindings([
      finding({ ruleNumber: '1', outcome: 'compliant', severity: null }),
      finding({ ruleNumber: '2', outcome: 'deviation', severity: 'low' }),
      finding({ ruleNumber: '3', outcome: 'not_applicable', severity: null }),
      finding({ ruleNumber: '4', outcome: 'absent', severity: 'blocker' }),
    ])
    expect(ordered.map((f) => f.ruleNumber)).toEqual(['4', '2', '1', '3'])
  })

  it('ranks by severity within the problems', () => {
    const ordered = orderFindings([
      finding({ ruleNumber: 'low', severity: 'low' }),
      finding({ ruleNumber: 'blocker', severity: 'blocker' }),
      finding({ ruleNumber: 'medium', severity: 'medium' }),
      finding({ ruleNumber: 'high', severity: 'high' }),
    ])
    expect(ordered.map((f) => f.ruleNumber)).toEqual(['blocker', 'high', 'medium', 'low'])
  })

  it('keeps an absence alongside a deviation of the same severity', () => {
    // Absence is the finding a review exists to catch, so it is never demoted
    // below a deviation just for being an absence.
    const ordered = orderFindings([
      finding({ ruleNumber: 'dev', outcome: 'deviation', severity: 'high' }),
      finding({ ruleNumber: 'abs', outcome: 'absent', severity: 'blocker' }),
    ])
    expect(ordered.map((f) => f.ruleNumber)).toEqual(['abs', 'dev'])
  })

  it('falls back to rule number so the order is stable', () => {
    const ordered = orderFindings([
      finding({ ruleNumber: '10', severity: 'high' }),
      finding({ ruleNumber: '2', severity: 'high' }),
    ])
    expect(ordered.map((f) => f.ruleNumber)).toEqual(['2', '10'])
  })

  it('does not mutate its input', () => {
    const input = [finding({ ruleNumber: '2', severity: 'low' }), finding({ ruleNumber: '1', severity: 'blocker' })]
    orderFindings(input)
    expect(input.map((f) => f.ruleNumber)).toEqual(['2', '1'])
  })
})

describe('isCitable', () => {
  it('is true only for a verified citation', () => {
    expect(isCitable(finding({ ruleNumber: '1', citation: { blockIndex: 0, charStart: 0, charEnd: 4, page: 1, bbox: null, quote: 'test', verification: 'verified' } }))).toBe(true)
  })

  it('is false when the model quoted something the document does not contain', () => {
    expect(isCitable(finding({ ruleNumber: '1', citationRefusal: 'not_found' }))).toBe(false)
  })

  it('is false for a stale citation, which is the point of storing the state', () => {
    expect(isCitable(finding({ ruleNumber: '1', citation: { blockIndex: 0, charStart: 0, charEnd: 4, page: 1, bbox: null, quote: 'test', verification: 'stale' } }))).toBe(false)
  })
})
