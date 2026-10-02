import { describe, expect, it } from 'vitest'
import { parentageFromIntakeParent, withParentChoice } from '@/lib/contacts/parentageFromIntake'
import { mergeChildInput } from '@/lib/contacts/mergeChildInput'
import type { HouseholdPerson } from '@/lib/contacts/getHousehold'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'

const CONTEXT = { clientFirstName: 'Jane', spouseFirstName: 'John' }

function existingChild(parentage: HouseholdPerson['parentage']): HouseholdPerson {
  return {
    contact_id: 'child-1',
    relationship_type: 'child',
    first_name: 'Alex',
    middle_name: null,
    last_name: 'Example',
    suffix: null,
    preferred_name: null,
    preferred_pronoun: null,
    prior_names: null,
    date_of_birth: '2010-01-01',
    is_us_citizen: null,
    citizenship_status: null,
    email: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    zip: null,
    county: null,
    child_relationship: 'biological',
    parentage,
    is_minor: true,
    roles: [],
  }
}

/** Hydrate the children step exactly as the intake page does from contacts. */
function hydratedChild(parentage: HouseholdPerson['parentage']): Record<string, unknown> {
  const hydrated = applyContactIntakeData(
    { id: 'intake-1', first_name: 'Jane', marital_status: 'married' },
    [
      { id: 'spouse-1', relationship_type: 'spouse', first_name: 'John', last_name: 'Example', contact_roles: [] },
      {
        id: 'child-1',
        relationship_type: 'child',
        first_name: 'Alex',
        last_name: 'Example',
        date_of_birth: '2010-01-01',
        parentage,
        child_relationship: 'biological',
        is_minor: true,
        contact_roles: [],
      },
    ],
  )
  return (hydrated._children as Array<Record<string, unknown>>)[0]
}

describe('parentageFromIntakeParent', () => {
  it('maps both to joint', () => {
    expect(parentageFromIntakeParent('both')).toBe('joint')
    expect(parentageFromIntakeParent('joint')).toBe('joint')
  })

  it('maps client and spouse first names', () => {
    expect(parentageFromIntakeParent('Jane', 'Jane', 'John')).toBe('client')
    expect(parentageFromIntakeParent('John', 'Jane', 'John')).toBe('spouse')
  })

  it('accepts the stored client / spouse literals', () => {
    expect(parentageFromIntakeParent('client', 'Jane', 'John')).toBe('client')
    expect(parentageFromIntakeParent('spouse', 'Jane', 'John')).toBe('spouse')
    expect(parentageFromIntakeParent('client')).toBe('client')
  })
})

describe('mergeChildInput parent mapping', () => {
  it('derives parentage from wizard parent field', () => {
    const merged = mergeChildInput(
      { first_name: 'Alex', last_name: 'Example', parent: 'both', date_of_birth: '2010-01-01' },
      undefined,
      CONTEXT,
    )
    expect(merged.parentage).toBe('joint')
  })

  it('lets a changed parent win over a stale hydrated parentage', () => {
    const merged = mergeChildInput(
      { contact_id: 'child-1', first_name: 'Alex', last_name: 'Example', parent: 'Jane', parentage: 'joint' },
      existingChild('joint'),
      CONTEXT,
    )
    expect(merged.parentage).toBe('client')
  })

  it('does not turn an unset parentage into joint for an untouched Both pill', () => {
    const merged = mergeChildInput(
      { contact_id: 'child-1', first_name: 'Alex', last_name: 'Example', parent: 'both', parentage: null },
      existingChild(null),
      CONTEXT,
    )
    expect(merged.parentage).toBeNull()
  })
})

describe('existing child: hydrate, change the Parent pill, save', () => {
  it('hydrates the parent as the pill value the step renders', () => {
    expect(hydratedChild('joint').parent).toBe('both')
    expect(hydratedChild('client').parent).toBe('Jane')
    expect(hydratedChild('spouse').parent).toBe('John')
  })

  it('saves a joint child changed to the client first name as client', () => {
    const child = hydratedChild('joint')
    expect(child.parentage).toBe('joint')

    const edited = withParentChoice(child, 'Jane')
    expect(edited).not.toHaveProperty('parentage')

    const merged = mergeChildInput(edited, existingChild('joint'), CONTEXT)
    expect(merged.parentage).toBe('client')
  })

  it('saves a client child changed to Both as joint', () => {
    const edited = withParentChoice(hydratedChild('client'), 'both')
    expect(mergeChildInput(edited, existingChild('client'), CONTEXT).parentage).toBe('joint')
  })

  it('keeps the stored parentage when the pill is untouched', () => {
    for (const parentage of ['joint', 'client', 'spouse', null] as const) {
      const merged = mergeChildInput(hydratedChild(parentage), existingChild(parentage), CONTEXT)
      expect(merged.parentage).toBe(parentage)
    }
  })
})
