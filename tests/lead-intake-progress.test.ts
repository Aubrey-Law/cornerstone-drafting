import { describe, expect, it } from 'vitest'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'

const completePersonal = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '617-555-0100',
  address_line1: '1 Main Street',
  city: 'Boston',
  state: 'MA',
  zip: '02108',
  date_of_birth: '1980-01-01',
  county: 'Suffolk',
}

const completeSingleIntake = {
  ...completePersonal,
  marital_status: 'single',
  has_children: false,
  estate_value: 'under_500k',
  asset_types: ['financial'],
  has_real_property: false,
  planning_goals: ['avoid_probate'],
  _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
  _fid_poa_client: [{ first_name: 'Alex', last_name: 'Agent' }],
  _fid_hcp_client: [{ first_name: 'Casey', last_name: 'Proxy' }],
  _fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Trustee' }],
}

function progressFor(intake: Record<string, unknown>) {
  return Object.fromEntries(getLeadIntakeProgress(intake).map(({ id, complete }) => [id, complete]))
}

describe('getLeadIntakeProgress', () => {
  it('returns the fixed seven-segment label order', () => {
    expect(getLeadIntakeProgress({})).toEqual([
      { id: 'contact', label: 'Contact', complete: false },
      { id: 'household', label: 'Household', complete: false },
      { id: 'assets', label: 'Assets', complete: false },
      { id: 'real_estate', label: 'Real estate', complete: false },
      { id: 'fiduciaries', label: 'Fiduciaries', complete: false },
      { id: 'wishes', label: 'Wishes', complete: false },
      { id: 'review', label: 'Review', complete: false },
    ])
  })

  it('requires the personal section but not optional referral information for Contact', () => {
    expect(progressFor(completePersonal).contact).toBe(true)
    expect(progressFor({ ...completePersonal, phone: '' }).contact).toBe(false)
  })

  it('requires only active spouse and children sections for Household', () => {
    expect(progressFor(completeSingleIntake).household).toBe(true)
    expect(progressFor({
      ...completeSingleIntake,
      marital_status: 'married',
      _spouse: { first_name: 'John', last_name: 'Doe', date_of_birth: '1981-01-01' },
      has_children: true,
      has_minor_children: true,
      _children: [{ first_name: 'Sam', last_name: 'Doe', date_of_birth: '2015-01-01' }],
    }).household).toBe(true)
    expect(progressFor({ ...completeSingleIntake, marital_status: 'married' }).household).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_children: true }).household).toBe(false)
  })

  it('keeps non-property estate requirements in Assets', () => {
    expect(progressFor(completeSingleIntake).assets).toBe(true)
    expect(progressFor({ ...completeSingleIntake, estate_value: '' }).assets).toBe(false)
    expect(progressFor({ ...completeSingleIntake, asset_types: [] }).assets).toBe(false)
  })

  it('normalizes the real AdminIntake boolean asset payload into Assets completion', () => {
    const adminIntakePayload = {
      ...completePersonal,
      marital_status: 'single',
      has_children: false,
      has_minor_children: false,
      estate_value: '500k_2m',
      has_real_property: false,
      has_retirement: true,
      has_investments: false,
      has_business: false,
      has_life_insurance: false,
    }

    expect(progressFor(adminIntakePayload).assets).toBe(true)
    expect(progressFor({ ...adminIntakePayload, has_retirement: false }).assets).toBe(false)
  })

  it('treats real estate as an explicit false-or-complete tri-state', () => {
    expect(progressFor(completeSingleIntake).real_estate).toBe(true)
    expect(progressFor({ ...completeSingleIntake, has_real_property: undefined }).real_estate).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_real_property: true }).real_estate).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_real_property: true, real_property_address: '1 Main Street' }).real_estate).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_real_property: true, real_property_value: '$500,000' }).real_estate).toBe(false)
    expect(progressFor({
      ...completeSingleIntake,
      has_real_property: true,
      real_property_address: '1 Main Street',
      real_property_value: '$500,000',
    }).real_estate).toBe(true)
    expect(progressFor({
      ...completeSingleIntake,
      has_real_property: true,
      financial_details: { real_property_address: '1 Main Street', real_property_value: '$500,000' },
    }).real_estate).toBe(true)
  })

  it('normalizes the wizard real-estate asset shape', () => {
    const wizardIntake = {
      ...completeSingleIntake,
      has_real_property: undefined,
      financial_details: {
        asset_types: ['real_estate'],
        real_estate: [{ address: '1 Main Street', value: '$500,000' }],
      },
    }

    expect(progressFor(wizardIntake).real_estate).toBe(true)
    expect(progressFor({
      ...wizardIntake,
      financial_details: { asset_types: ['real_estate'], real_estate: [{ address: '1 Main Street', value: '' }] },
    }).real_estate).toBe(false)
    expect(progressFor({
      ...completeSingleIntake,
      has_real_property: undefined,
      financial_details: { asset_types: ['financial'] },
    }).real_estate).toBe(true)
    expect(progressFor({ ...completeSingleIntake, has_real_property: undefined, financial_details: {} }).real_estate).toBe(false)
  })

  it('requires active spouse and guardian fiduciaries', () => {
    expect(progressFor(completeSingleIntake).fiduciaries).toBe(true)
    expect(progressFor({ ...completeSingleIntake, marital_status: 'married' }).fiduciaries).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_children: true, has_minor_children: true }).fiduciaries).toBe(false)
    expect(progressFor({ ...completeSingleIntake, has_children: false, has_minor_children: true }).fiduciaries).toBe(true)
    expect(progressFor({
      ...completeSingleIntake,
      marital_status: 'married',
      has_children: true,
      has_minor_children: true,
      _fid_personal_rep_spouse: [{ first_name: 'John', last_name: 'Representative' }],
      _fid_poa_spouse: [{ first_name: 'John', last_name: 'Agent' }],
      _fid_hcp_spouse: [{ first_name: 'John', last_name: 'Proxy' }],
      _fid_guardian_client: [{ first_name: 'Morgan', last_name: 'Guardian' }],
    }).fiduciaries).toBe(true)
  })

  it('uses Goals completion and submitted or approved statuses for Wishes and Review', () => {
    expect(progressFor(completeSingleIntake).wishes).toBe(true)
    expect(progressFor({ ...completeSingleIntake, planning_goals: [] }).wishes).toBe(false)
    expect(progressFor({ ...completeSingleIntake, status: 'draft' }).review).toBe(false)
    expect(progressFor({ ...completeSingleIntake, status: 'submitted' }).review).toBe(true)
    expect(progressFor({ ...completeSingleIntake, status: 'approved' }).review).toBe(true)
  })
})
