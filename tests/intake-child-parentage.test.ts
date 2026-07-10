import { describe, expect, it } from 'vitest'
import { parentageFromIntakeParent } from '@/lib/contacts/parentageFromIntake'
import { mergeChildInput } from '@/lib/contacts/mergeChildInput'

describe('parentageFromIntakeParent', () => {
  it('maps both to joint', () => {
    expect(parentageFromIntakeParent('both')).toBe('joint')
    expect(parentageFromIntakeParent('joint')).toBe('joint')
  })

  it('maps client and spouse first names', () => {
    expect(parentageFromIntakeParent('Jane', 'Jane', 'John')).toBe('client')
    expect(parentageFromIntakeParent('John', 'Jane', 'John')).toBe('spouse')
  })
})

describe('mergeChildInput parent mapping', () => {
  it('derives parentage from wizard parent field', () => {
    const merged = mergeChildInput(
      { first_name: 'Alex', last_name: 'Example', parent: 'both', date_of_birth: '2010-01-01' },
      undefined,
      { clientFirstName: 'Jane', spouseFirstName: 'John' },
    )
    expect(merged.parentage).toBe('joint')
  })
})
