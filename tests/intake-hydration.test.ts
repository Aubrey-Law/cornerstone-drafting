import { describe, expect, it } from 'vitest'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { applyContactIntakeData } from '@/lib/intakeContactHydration'

describe('unpackInitialIntakeData', () => {
  it.each([
    'children', 'additional_contacts', 'fid_trustee_client', 'fid_trustee_spouse',
    'fid_personal_rep_client', 'fid_personal_rep_spouse', 'fid_poa_client', 'fid_poa_spouse',
    'fid_hcp_client', 'fid_hcp_spouse', 'fid_guardian_client', 'fid_excluded_guardian',
  ])('keeps current %s answers and explicit removals ahead of legacy snapshots', key => {
    const stale = [{ first_name: 'Old', last_name: 'Snapshot' }]
    for (const current of [[{ contact_id: 'current-id', first_name: 'Current', priority: 2 }], []]) {
      const input = { [`_${key}`]: current, fiduciary_entries: { [key]: stale } }
      const unpacked = unpackInitialIntakeData(input)
      expect(unpacked[`_${key}`]).toBe(current)
      expect(unpackInitialIntakeData(unpacked)[`_${key}`]).toBe(current)
      expect(input.fiduciary_entries[key]).toBe(stale)
    }
    expect(unpackInitialIntakeData({ fiduciary_entries: { [key]: stale } })[`_${key}`]).toBe(stale)
  })

  it('preserves contact identity, current household details, and appointment priority through interview initialization', () => {
    const hydrated = applyContactIntakeData({ fiduciary_entries: {
      children: [{ first_name: 'Stale child' }],
      fid_poa_spouse: [{ first_name: 'Stale nominee', priority: 1 }],
      fid_guardian_client: [{ first_name: 'Legacy guardian' }],
    } }, [
      { id: 'child-id', relationship_type: 'child', first_name: 'Current child', last_name: 'Family', date_of_birth: '2015-01-01' },
      { id: 'nominee-id', first_name: 'Current nominee', last_name: 'Family', contact_roles: [
        { role: 'poa', for_party: 'spouse', priority: 2, is_coagent: false },
      ] },
    ])
    const unpacked = unpackInitialIntakeData(hydrated)
    expect(unpacked._children).toEqual([expect.objectContaining({ contact_id: 'child-id', first_name: 'Current child', date_of_birth: '2015-01-01' })])
    expect(unpacked._fid_poa_spouse).toEqual([expect.objectContaining({ contact_id: 'nominee-id', first_name: 'Current nominee', priority: 2 })])
    expect(unpacked._fid_guardian_client).toEqual([{ first_name: 'Legacy guardian' }])
  })

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
