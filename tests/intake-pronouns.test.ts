import { describe, expect, it } from 'vitest'
import {
  adminFiduciaryEntriesFromForm,
  adminFiduciaryFlatFromRoles,
} from '@/lib/adminIntakeFiduciaries'
import { childInputToContactPayload } from '@/lib/contacts/childMapping'
import { fiduciaryEntriesToRoles } from '@/lib/contacts/fiduciaryEntriesToRoles'
import { mergeChildInput } from '@/lib/contacts/mergeChildInput'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'
import { buildIntakeSeedPayload } from '@/lib/designSheet/seedFromIntake'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
import type { IntakeSnapshot } from '@/lib/queries'
import type { HouseholdPerson } from '@/lib/contacts/getHousehold'

function householdPerson(patch: Partial<HouseholdPerson>): HouseholdPerson {
  return {
    contact_id: 'contact-1',
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
    email: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    zip: null,
    county: null,
    child_relationship: 'biological',
    parentage: null,
    is_minor: true,
    roles: [],
    ...patch,
  }
}

describe('child pronouns reach the contacts row', () => {
  it('maps the wizard `pronouns` key onto preferred_pronoun', () => {
    const merged = mergeChildInput(
      { first_name: 'Alex', last_name: 'Example', pronouns: 'they/them', date_of_birth: '2010-01-01' },
      undefined,
    )
    expect(merged.preferred_pronoun).toBe('they/them')
  })

  it('accepts the contacts-style key as well', () => {
    const merged = mergeChildInput(
      { first_name: 'Alex', last_name: 'Example', preferred_pronoun: 'she/her' },
      undefined,
    )
    expect(merged.preferred_pronoun).toBe('she/her')
  })

  it('keeps the stored pronoun when the payload omits one', () => {
    const merged = mergeChildInput(
      { first_name: 'Alex', last_name: 'Example' },
      householdPerson({ preferred_pronoun: 'he/him' }),
    )
    expect(merged.preferred_pronoun).toBe('he/him')
  })

  it('writes the pronoun into the contacts payload', () => {
    const payload = childInputToContactPayload(
      {
        first_name: 'Alex',
        last_name: 'Example',
        dob: '2010-01-01',
        relationship: 'biological',
        preferred_pronoun: 'they/them',
      },
      null,
    )
    expect(payload.preferred_pronoun).toBe('they/them')
  })
})

describe('fiduciary pronouns', () => {
  it('carries pronouns off the wizard fiduciary entries', () => {
    const roles = fiduciaryEntriesToRoles({
      fid_trustee_client: [
        { first_name: 'Dana', last_name: 'Reed', preferred_pronoun: 'she/her' },
        { first_name: 'Sam', last_name: 'Ito', pronouns: 'they/them' },
      ],
    })
    expect(roles).toHaveLength(2)
    expect(roles[0].preferred_pronoun).toBe('she/her')
    expect(roles[1].preferred_pronoun).toBe('they/them')
  })

  it('carries pronouns off the attorney sheet fiduciary fields', () => {
    const entries = adminFiduciaryEntriesFromForm({
      ...emptyAdminIntakeFormData(),
      trustee_primary: 'Dana Reed',
      trustee_primary_pronouns: 'she/her',
      hcp_primary: 'Sam Ito',
    })
    const trustee = entries.find((e) => e.role === 'trustee')
    const hcp = entries.find((e) => e.role === 'hcp')
    expect(trustee?.preferred_pronoun).toBe('she/her')
    // No pronoun chosen — nothing to write, and nothing to clear.
    expect(hcp?.preferred_pronoun).toBeNull()
  })

  it('round-trips pronouns back into the attorney sheet fields', () => {
    const flat = adminFiduciaryFlatFromRoles([
      {
        role: 'trustee',
        for_party: 'client',
        priority: 1,
        is_coagent: false,
        first_name: 'Dana',
        last_name: 'Reed',
        preferred_pronoun: 'she/her',
      },
    ])
    expect(flat.trustee_primary).toBe('Dana Reed')
    expect(flat.trustee_primary_pronouns).toBe('she/her')
  })
})

describe('hydration exposes pronouns for people the intake forms edit', () => {
  it('includes the spouse citizenship and pronoun, and the fiduciary pronoun', () => {
    const hydrated = applyContactIntakeData({ id: 'intake-1' }, [
      {
        id: 'spouse-1',
        relationship_type: 'spouse',
        first_name: 'Robin',
        last_name: 'Reed',
        preferred_pronoun: 'they/them',
        is_us_citizen: false,
        contact_roles: [],
      },
      {
        id: 'contact-9',
        relationship_type: 'other',
        first_name: 'Dana',
        last_name: 'Reed',
        preferred_pronoun: 'she/her',
        contact_roles: [{ role: 'trustee', for_party: 'client', priority: 1, is_coagent: false }],
      },
    ])

    const spouse = hydrated._spouse as Record<string, unknown>
    expect(spouse.preferred_pronoun).toBe('they/them')
    expect(spouse.is_us_citizen).toBe(false)

    const trustees = hydrated._fid_trustee_client as Array<Record<string, unknown>>
    expect(trustees[0].preferred_pronoun).toBe('she/her')
  })
})

describe('spouse citizenship reaches the design sheet', () => {
  it('seeds spouse_citizenship from the intake answer', () => {
    const intake = {
      spouse_is_us_citizen: false,
      spouse_preferred_pronoun: 'they/them',
    } as unknown as IntakeSnapshot

    const seed = buildIntakeSeedPayload(intake)
    expect(seed.spouse_citizenship).toBe('Non-Resident Alien')
    expect(seed.spouse_pronouns).toBe('they/them')
  })
})
