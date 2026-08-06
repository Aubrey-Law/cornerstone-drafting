import { describe, expect, it } from 'vitest'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'

describe('unpackInitialIntakeData', () => {
  it('hydrates persisted JSON and legacy fields for the guided interview', () => {
    const hydrated = unpackInitialIntakeData({
      financial_details: {
        asset_types: ['real_estate'],
        business_notes: 'Closely held company',
      },
      review_choices: { estate: 'discuss_with_attorney' },
      fiduciary_entries: {
        children: [{ first_name: 'Taylor' }],
        additional_contacts: [{ first_name: 'Jordan' }],
        fid_poa_client: [{ first_name: 'Morgan' }],
        review_choices: { estate: 'not_provided_yet' },
      },
      spouse_first_name: 'Jamie',
      spouse_phone: '6175551212',
      goals: 'Protect family',
      additional_notes: 'Call before filing',
      excluded_guardians: 'Pat Doe',
      pronouns: 'they/them',
      address_line1: '1 Main Street',
    })

    expect(hydrated.asset_types).toEqual(['real_estate'])
    expect(hydrated.financial_business_notes).toBe('Closely held company')
    expect(hydrated._review_choices).toEqual({ estate: 'discuss_with_attorney' })
    expect(hydrated._children).toEqual([{ first_name: 'Taylor' }])
    expect(hydrated._additional_contacts).toEqual([{ first_name: 'Jordan' }])
    expect(hydrated._fid_poa_client).toEqual([{ first_name: 'Morgan' }])
    expect(hydrated._spouse).toMatchObject({ first_name: 'Jamie', phone: '(617) 555-1212' })
    expect(hydrated).toMatchObject({
      planning_goals: 'Protect family',
      special_notes: 'Call before filing',
      excluded_guardian: 'Pat Doe',
      preferred_pronoun: 'they/them',
      street_address: '1 Main Street',
    })
    expect(hydrated).not.toHaveProperty('financial_details')
    expect(hydrated).not.toHaveProperty('fiduciary_entries')
  })
})
