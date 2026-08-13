import { describe, expect, it } from 'vitest'
import {
  buildIntakeResyncPatch,
  buildIntakeResyncPreview,
  buildIntakeSeedDecisions,
  buildIntakeSeedPayload,
  INTAKE_SEED_FIELD_META,
  isDesignSheetUnseeded,
} from '@/lib/designSheet/seedFromIntake'
import { SHARED_PREFILLED_DESIGN_KEYS } from '@/lib/sharedFields'
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
    prior_names: 'Jane Maiden',
    is_us_citizen: true,
    citizenship_status: 'us_citizen',
    spouse_first_name: 'John',
    spouse_middle_name: null,
    spouse_last_name: 'Example',
    spouse_date_of_birth: '1972-02-02',
    spouse_phone: '5550200',
    spouse_email: 'john@example.com',
    spouse_preferred_pronoun: 'he/him',
    spouse_prior_names: 'John Former',
    spouse_is_us_citizen: true,
    spouse_citizenship_status: 'us_citizen',
    date_of_marriage: '2000-03-03',
    children: [{
      name: 'Alex Example',
      dob: '2010-04-04',
      relationship: 'biological',
      parentage: 'joint',
      is_minor: true,
    }],
    has_minor_children: true,
    planning_goals: ['avoid_probate', 'protect_children'],
    planning_objectives: null,
    special_circumstances: null,
    special_notes: 'Needs special trust language.',
    excluded_guardian: 'Unfit Relative',
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
    trustee_slots: [{
      id: 'slot-1',
      contact_id: 'contact-trustee',
      is_co: false,
      order: 0,
    }],
    executor_slots: [{
      id: 'slot-2',
      contact_id: 'contact-pr',
      is_co: false,
      order: 0,
    }],
    poa_slots: null,
    hcp_slots: null,
    guardian_slots: null,
    spouse_executor_slots: null,
    spouse_trustee_slots: null,
    spouse_poa_slots: null,
    spouse_hcp_slots: null,
    goals_extended: null,
    real_estate_extended: null,
    financial_accounts: null,
    beneficiaries: null,
    plan_type: null,
    document_inclusions: null,
    ...overrides,
  }
}

describe('seedFromIntake', () => {
  it('builds a design-sheet seed payload from intake', () => {
    const payload = buildIntakeSeedPayload(intake())

    expect(payload).toMatchObject({
      client_name: 'Jane Example',
      client_pronouns: 'she/her',
      client_aka: 'Jane Maiden',
      client_citizenship: 'US Citizen',
      client_domicile: 'MA',
      spouse_name: 'John Example',
      spouse_aka: 'John Former',
      spouse_citizenship: 'US Citizen',
      street: '1 Main St',
      executor_primary: 'Pat Executor',
      concerns: 'Needs special trust language.',
      excluded_guardian_flag: true,
      excluded_guardian_name: 'Unfit Relative',
    })
    expect(payload.goals_notes).toContain('Avoid probate')
    expect(payload.children).toHaveLength(1)
    expect(payload.children?.[0]).toMatchObject({
      is_minor: true,
      parentage: 'joint',
    })
    expect(payload.trustee_slots?.[0].contact_id).toBe('contact-trustee')
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

  it('maps the intake plan-structure choice into plan_type and is_joint', () => {
    const payload = buildIntakeSeedPayload(intake({ plan_type: 'joint_rlt' }))
    expect(payload.plan_type).toBe('pour_over')
    expect(payload.is_joint).toBe(true)

    const willBased = buildIntakeSeedPayload(intake({ plan_type: 'will_based' }))
    expect(willBased.plan_type).toBe('outright_will')
    expect(willBased.is_joint).toBe(false)

    const none = buildIntakeSeedPayload(intake())
    expect(none.plan_type).toBeNull()
    expect(none.is_joint).toBeNull()
  })

  it('seeds document inclusions from the plan choice and attorney toggles', () => {
    expect(buildIntakeSeedDecisions(intake(), null)).toBeUndefined()

    const willBased = buildIntakeSeedDecisions(intake({ plan_type: 'will_based' }), null)
    expect(willBased?.document_inclusions).toMatchObject({ trust: false, will: true, dpoa: true, healthcare: true })

    const explicit = buildIntakeSeedDecisions(
      intake({ plan_type: 'incapacity_only', document_inclusions: { dpoa: true, healthcare: false } }),
      { existing_key: 'kept', document_inclusions: { deed: true } } as never,
    )
    expect(explicit).toMatchObject({
      existing_key: 'kept',
      document_inclusions: { trust: false, will: false, dpoa: true, healthcare: false, deed: true },
    })
  })

  it('covers registry prefilled design keys in seed metadata', () => {
    const seeded = new Set(Object.keys(INTAKE_SEED_FIELD_META))
    const computedFromParts = new Set(['client_name', 'spouse_name'])
    const attorneyOnlyFromRegistry = new Set(['marriage_date'])

    for (const key of SHARED_PREFILLED_DESIGN_KEYS) {
      if (computedFromParts.has(key)) continue
      if (attorneyOnlyFromRegistry.has(key) && seeded.has(key)) continue
      expect(seeded.has(key), `missing seed field for registry key ${key}`).toBe(true)
    }
  })
})
