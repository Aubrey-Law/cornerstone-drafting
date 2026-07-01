import { describe, expect, it } from 'vitest'
import { sheetHasMinorChildren, sheetMinorChildren } from '@/lib/designSheet/minorChildren'

describe('sheetHasMinorChildren', () => {
  it('returns false when there are no children', () => {
    expect(sheetHasMinorChildren([])).toBe(false)
    expect(sheetHasMinorChildren(null)).toBe(false)
  })

  it('returns false when all children are adults', () => {
    expect(sheetHasMinorChildren([
      { name: 'Alex', dob: '2000-01-01', relationship: 'biological', is_minor: false },
    ])).toBe(false)
  })

  it('returns true when at least one child is minor', () => {
    const children = [
      { name: 'Alex', dob: '2000-01-01', relationship: 'biological' as const, is_minor: false },
      { name: 'Sam', dob: '2015-01-01', relationship: 'biological' as const, is_minor: true },
    ]
    expect(sheetHasMinorChildren(children)).toBe(true)
    expect(sheetMinorChildren(children)).toHaveLength(1)
    expect(sheetMinorChildren(children)[0]?.name).toBe('Sam')
  })
})
