import { describe, expect, it } from 'vitest'
import { normalizeTargetSigningDate } from '@/lib/matterDates'

describe('target signing normalization', () => {
  it('stores date-only values at noon UTC to avoid US timezone day shifts', () => {
    expect(normalizeTargetSigningDate('2026-11-08')).toBe('2026-11-08T12:00:00.000Z')
  })

  it('preserves a valid appointment timestamp', () => {
    expect(normalizeTargetSigningDate('2026-11-08T15:30:00.000Z'))
      .toBe('2026-11-08T15:30:00.000Z')
  })

  it('rejects invalid values', () => {
    expect(normalizeTargetSigningDate('not-a-date')).toBeNull()
  })
})
