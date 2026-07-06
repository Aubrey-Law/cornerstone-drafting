import { describe, expect, it } from 'vitest'
import {
  buildIntakeResyncPatch,
  buildIntakeResyncPreview,
  buildIntakeSeedPayload,
  isDesignSheetUnseeded,
} from '@/lib/designSheet/seedFromIntake'
import type { IntakeSnapshot } from '@/lib/queries'

function intake(overrides: Partial<IntakeSnapshot> = {}): IntakeSnapshot {
  return {
    first_name: 'Jane',
    middle_name: null,
    last_name: 'Example',
    suffix: null,
    date_of_birth: '1970-01-01',
    phone: '5550100',
    email: 'jane@example.com',
    address_line1: '1 Main St',
    city: 'Boston',
    state: 'MA',
    zip: '02108',
    county: 'Suffolk',
    marital_status: 'married',
    preferred_pronoun: 'she/her',
    spouse_first_name: 'John',
    spouse_middle_name: null,
    spouse_last_name: 'Example',
    spouse_date_of_birth: '1972-02-02',
    spouse_phone: '5550200',
    spouse_email: 'john@example.com',
    spouse_preferred_pronoun: 'he/him',
    date_of_marriage: '2000-03-03',
    children: [{ name: 'Alex Example', date_of_birth: '2010-04-04', relationship: 'biological' }],
    has_minor_children: true,
    planning_objectives: null,
    special_circumstances: null,
    special_notes: null,
    has_will: null,
    has_trust: null,
    has_poa: null,
    has_hcp: null,
    estate_value: null,
    has_real_property: null,
    real_property_address: null,
    real_property_value: null,
    has_retirement: null,
    retirement_value: null,
    has_life_insurance: null,
    life_insurance_value: null,
    has_business: null,
    business_description: null,
    has_investments: null,
    trustee_primary: 'Pat Trustee',
    trustee_alternate: null,
    executor_primary: 'Pat Executor',
    executor_alternate: null,
    poa_primary: null,
    poa_alternate: null,
    hcp_primary: null,
    hcp_alternate: null,
    guardian_primary: null,
    guardian_alternate: null,
    goals_extended: null,
    real_estate_extended: null,
    financial_accounts: null,
    beneficiaries: null,
    ...overrides,
  }
}

describe('seedFromIntake', () => {
  it('builds a design-sheet seed payload from intake', () => {
    const payload = buildIntakeSeedPayload(intake())

    expect(payload).toMatchObject({
      client_name: 'Jane Example',
      client_pronouns: 'she/her',
      spouse_name: 'John Example',
      street: '1 Main St',
      executor_primary: 'Pat Executor',
    })
    expect(payload.children).toHaveLength(1)
  })

  it('detects unseeded design sheets by client_name', () => {
    expect(isDesignSheetUnseeded({ client_name: null })).toBe(true)
    expect(isDesignSheetUnseeded({ client_name: 'Jane Example' })).toBe(false)
  })

  it('blocks overridden fields in the resync preview', () => {
    const preview = buildIntakeResyncPreview({
      intake: intake({ city: 'Cambridge' }),
      currentSheet: {
        city: 'Boston',
        overrides: {
          city: { original: 'Boston', updated_by: 'attorney' },
        },
      },
    })

    const cityRow = preview.find(row => row.field === 'city')
    expect(cityRow?.blocked).toBe(true)
    expect(cityRow?.selected).toBe(false)
  })

  it('applies selected resync fields and clears matching overrides', () => {
    const patch = buildIntakeResyncPatch({
      intake: intake({ email: 'updated@example.com' }),
      currentSheet: {
        overrides: {
          client_email: { original: 'jane@example.com', updated_by: 'attorney' },
        },
      },
      fields: ['client_email'],
    })

    expect(patch.client_email).toBe('updated@example.com')
    expect(patch.overrides).toBeNull()
  })
})
