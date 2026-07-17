import { describe, expect, it } from 'vitest'
import { clampZoom, nextChangeIndex } from '@/lib/drafting/changeNavigation'

describe('nextChangeIndex', () => {
  it('starts Next at the first change and Prev at the last when nothing is focused', () => {
    expect(nextChangeIndex(-1, 1, 5)).toBe(0)
    expect(nextChangeIndex(-1, -1, 5)).toBe(4)
  })

  it('steps forward and backward', () => {
    expect(nextChangeIndex(2, 1, 5)).toBe(3)
    expect(nextChangeIndex(2, -1, 5)).toBe(1)
  })

  it('wraps around both ends', () => {
    expect(nextChangeIndex(4, 1, 5)).toBe(0)
    expect(nextChangeIndex(0, -1, 5)).toBe(4)
  })

  it('returns -1 for an empty change set', () => {
    expect(nextChangeIndex(-1, 1, 0)).toBe(-1)
    expect(nextChangeIndex(3, -1, 0)).toBe(-1)
  })
})

describe('clampZoom', () => {
  it('clamps to the 0.6–2 range', () => {
    expect(clampZoom(0.2)).toBe(0.6)
    expect(clampZoom(3)).toBe(2)
    expect(clampZoom(1.25)).toBe(1.25)
  })

  it('falls back to 1 for non-finite input', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
  })
})
