import { describe, expect, it } from 'vitest'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'

describe('normalizeJurisdictionStateCode', () => {
  it('maps Massachusetts spellings to MA', () => {
    expect(normalizeJurisdictionStateCode('Massachusetts')).toBe('MA')
    expect(normalizeJurisdictionStateCode('massachusetts')).toBe('MA')
    expect(normalizeJurisdictionStateCode('Commonwealth of Massachusetts')).toBe('MA')
  })

  it('normalizes two-letter codes', () => {
    expect(normalizeJurisdictionStateCode('ma')).toBe('MA')
    expect(normalizeJurisdictionStateCode('MA')).toBe('MA')
  })

  it('defaults blank values to MA', () => {
    expect(normalizeJurisdictionStateCode(null)).toBe('MA')
    expect(normalizeJurisdictionStateCode('')).toBe('MA')
  })
})
