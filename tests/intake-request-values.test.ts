import { describe, expect, it } from 'vitest'

import { optionalDateOrNull } from '@/lib/intakeRequestValues'

describe('optionalDateOrNull', () => {
  it('preserves an omitted date on a partial or status-only request', () => {
    expect(optionalDateOrNull(undefined)).toBeUndefined()
  })

  it('allows an explicit blank date to clear a saved value', () => {
    expect(optionalDateOrNull('')).toBeNull()
    expect(optionalDateOrNull(null)).toBeNull()
  })

  it('passes through a provided date', () => {
    expect(optionalDateOrNull('1975-01-01')).toBe('1975-01-01')
  })
})
