import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney } from '@/lib/funding/format'

describe('formatMoney', () => {
  it('writes whole dollars, because cents make an amount look like a computation', () => {
    expect(formatMoney(1_240_000)).toBe('$1,240,000')
    expect(formatMoney(1250.5)).toBe('$1,251')
  })

  it('writes zero rather than an empty space', () => {
    expect(formatMoney(0)).toBe('$0')
  })
})

describe('formatDate', () => {
  /**
   * A stored `date` has no time. Parsing it as local time moves it a day
   * backwards for anyone west of UTC, so a confirmation received on the 1st
   * would read as the 31st — on a record whose whole purpose is proving when.
   */
  it('does not shift a stored date across a timezone', () => {
    expect(formatDate('2026-08-01')).toBe('Aug 1, 2026')
  })

  it('has nothing to say about a missing date', () => {
    expect(formatDate(null)).toBeNull()
  })

  it('returns an unrecognised value unchanged rather than inventing a date', () => {
    expect(formatDate('soon')).toBe('soon')
  })
})
