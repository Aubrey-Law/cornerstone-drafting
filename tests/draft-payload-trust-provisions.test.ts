import { describe, expect, it } from 'vitest'

import {
  defaultDraftPayloadTrustProvisions,
  descendantsDistributionMethod,
  draftPayloadTrustProvisions,
  formatTrustDisplayName,
  trustCoTrusteesAction,
} from '@/lib/draftPayload/trustProvisions'
import { defaultDraftPayloadDpoaProvisions } from '@/lib/draftPayload/defaults'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'
import type { DraftPayload } from '@/lib/draftPayload/types'

function basePayload(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    matter: {
      id: 'matter-1',
      matter_number: 'EP-1',
      type: 'married_individual',
      trust_type: 'revocable_living',
      practice_area: 'Estate Planning',
      minor_children: false,
    },
    client: {
      first_name: 'Jane',
      last_name: 'Smith',
      full_name: 'Jane Smith',
      aka: null,
      preferred_pronoun: null,
      dob: null,
      address: null,
      city: null,
      county: null,
      state: 'MA',
      zip: null,
      email: null,
      phone: null,
      excluded_guardian: null,
    },
    spouse: {
      first_name: 'John',
      last_name: 'Smith',
      full_name: 'John Smith',
      aka: null,
      preferred_pronoun: null,
      dob: null,
    },
    children: [],
    trust: {
      name: 'The Jane Smith Trust',
      spouse_name: 'The John Smith Trust',
      display_name: 'THE JANE SMITH TRUST, U/A dated January 15, 2025',
      spouse_display_name: 'THE JOHN SMITH TRUST, U/A dated January 15, 2025',
      date: '2025-01-15',
      distribution_ages: [30],
      ma_estate_taxable: false,
      ma_estate_tax_savings: null,
      separate_trusts: true,
      has_ilit: false,
      ilit_trustee: null,
    },
    trust_provisions: defaultDraftPayloadTrustProvisions(),
    fiduciaries: {
      pr_primary: null,
      pr_co_primary: null,
      pr_successor: null,
      pr_co_successor: null,
      pr_second_successor: null,
      dpoa_primary: null,
      dpoa_co_agent: null,
      dpoa_successor: null,
      hcp_primary: null,
      hcp_primary_address: null,
      hcp_primary_relationship: null,
      hcp_successor: null,
      hcp_successor_address: null,
      hcp_successor_relationship: null,
      trustee_initial: 'Jane Smith',
      trustee_co: null,
      trustee_successor: 'Taylor Trustee',
      trustee_co_successor: null,
      trustee_second_successor: null,
      trustee_co_second_successor: null,
      guardian_primary: null,
      guardian_successor: null,
      guardian_second_successor: null,
      temp_guardian_primary: null,
      temp_guardian_co: null,
      temp_guardian_successor: null,
      temp_guardian_second_successor: null,
      spouse_pr_co_primary: null,
      spouse_pr_primary: null,
      spouse_pr_successor: null,
      spouse_dpoa_primary: null,
      spouse_dpoa_successor: null,
      spouse_hcp_primary: null,
      spouse_hcp_primary_address: null,
      spouse_hcp_primary_relationship: null,
      spouse_hcp_successor: null,
      spouse_hcp_successor_address: null,
      spouse_hcp_successor_relationship: null,
      spouse_trustee_successor: null,
      spouse_trustee_co: null,
    },
    documents: {
      include_trust: true,
      include_pour_over_will: true,
      include_simple_will: false,
      include_testamentary_trust_will: false,
      include_dpoa: false,
      include_hcp: false,
      include_hipaa: false,
      include_ahd: false,
      include_ppm: false,
      include_parental_appointment: false,
      include_temp_delegation: false,
      spouse_docs: true,
      trust_planning_type: 'disclaimer',
    },
    will_provisions: {
      pr_structure: null,
      trustee_structure: null,
      cotrustee_decision_standard: null,
      bond: 'no_bond',
      supervision: 'unsupervised',
      simultaneous_death: null,
      utma_age: 21,
      no_contest_clause: 'omit',
      include_disclaimer_article: true,
      include_self_proving_affidavit: true,
      tangible_property_distribution: null,
      tangible_property_named_individual: null,
      pour_over_alternate_disposition: null,
      pour_over_alternate_named: null,
      outright_residuary: null,
      outright_residuary_named: null,
      outright_residuary_alternate: null,
      beneficiary_structure: null,
      single_beneficiary_name: null,
      single_beneficiary_remainder: null,
      age_distribution_schedule: null,
      trust_protector: false,
      trust_protector_name: null,
      pet_care_option: 'omit',
      pet_care_details: {},
      specific_bequests: [],
      pr_powers: {
        allow_pay_taxes_debts_expenses: false,
        allow_manage_digital_assets: false,
        include_distribution_cash_or_kind: false,
      },
    },
    dpoa_provisions: defaultDraftPayloadDpoaProvisions(),
    hcp_provisions: {
      anatomical_gift: null,
      anatomical_specified: null,
    },
    hipaa_provisions: {
      psychotherapy_notes: null,
    },
    execution: {
      signing_month: null,
      signing_year: null,
      signing_county: null,
      notary_commission_expiration: null,
    },
    design_sheet_id: 'sheet-1',
    special_provisions: null,
    ancillary_docs: [],
    notes: null,
    ...overrides,
  }
}

describe('draft payload trust provisions wiring', () => {
  it('formats trust display names for deeds', () => {
    expect(formatTrustDisplayName('Smith Family Trust', '2025-01-15', {
      date_style: 'ua_dated',
      append_amendments: true,
    })).toBe('SMITH FAMILY TRUST, U/A dated January 15, 2025, and any amendments thereto')

    expect(formatTrustDisplayName('Smith Family Trust', '2025-01-15', {
      date_style: 'dated_only',
      append_amendments: false,
    })).toBe('SMITH FAMILY TRUST dated January 15, 2025')
  })

  it('maps design sheet trust details into draft payload trust provisions', () => {
    const provisions = draftPayloadTrustProvisions({
      decisions: {
        trust_planning_type: 'clayton_election',
        trust_details: {
          co_trustee_decision: 'independent',
          residual_beneficiary_method: 'outright',
          successor_trustee_vacancy: 'settlor_or_court',
          include_no_contest_clause: true,
        },
      },
      restatement: true,
      trust_protector: true,
      trust_protector_name: 'Protector Person',
      residual_beneficiary: 'descendants',
      distribution_method: 'outright',
      distribution_age: 30,
      staggered_distributions: [],
      remote_beneficiary: 'named',
      remote_beneficiary_charities: [{ id: '1', name: 'Example Charity' }],
      provision_substance_abuse: 'yes',
      provision_married_beneficiary: 'no',
      no_contest_clause: 'omit',
    })

    expect(provisions.spousal_funding).toBe('clayton_election')
    expect(provisions.co_trustee_decision).toBe('independent')
    expect(provisions.residual_beneficiary_method).toBe('outright')
    expect(provisions.include_no_contest_clause).toBe(true)
    expect(provisions.include_substance_abuse).toBe(true)
    expect(provisions.remote_beneficiary_charity_names).toEqual(['Example Charity'])
  })

  it('maps trust provisions into estate generator trust data', () => {
    const data = toEstateGeneratorData(basePayload({
      trust_provisions: defaultDraftPayloadTrustProvisions({
        spousal_funding: 'disclaimer',
        co_trustee_decision: 'independent',
        residual_beneficiary_method: 'outright',
        distribution_age: 30,
        residuary_after_death: 'descendants_outright_per_stirpes',
        include_no_contest_clause: true,
        remote_beneficiary: 'heirs_at_law',
      }),
    }))

    expect(data.trust.spousal_funding).toBe('disclaimer')
    expect(data.trust.descendants_distribution).toEqual({
      method: 'outright',
      distribution_age: '30',
      stage_1_age: '30',
      stage_2_age: undefined,
      stage_3_age: undefined,
    })
    expect(data.trust.residuary_after_death).toBe('descendants_outright_per_stirpes')
    expect(data.will.no_contest_clause).toBe('include')
    expect(data.fiduciaries.trustee).toMatchObject({ co_trustees_action: 'independent' })
  })

  it('maps co-trustee decision standards for generator templates', () => {
    expect(trustCoTrusteesAction('joint_majority')).toBe('joint')
    expect(trustCoTrusteesAction('independent')).toBe('independent')
    expect(descendantsDistributionMethod('outright', 'staggered')).toBe('outright')
    expect(descendantsDistributionMethod(null, 'staggered')).toBe('staged')
  })
})

// Regression: this used to end in a bare `return 'staged'`, so a matter where nobody
// picked a method — or one carrying an unrecognised legacy value — still generated a
// complete staged-distribution trust. Null leaves the generator field absent so the
// draft preflight reports it instead.
describe('descendantsDistributionMethod', () => {
  it('maps each recognised method', () => {
    expect(descendantsDistributionMethod('outright', null)).toBe('outright')
    expect(descendantsDistributionMethod('staggered', null)).toBe('staged')
    expect(descendantsDistributionMethod('trust_for_life', null)).toBe('trust_for_life')
    expect(descendantsDistributionMethod('custom', null)).toBe('custom')
  })

  it('accepts the hyphenated option value from either home', () => {
    expect(descendantsDistributionMethod('trust-for-life' as never, null)).toBe('trust_for_life')
    expect(descendantsDistributionMethod(null, 'trust-for-life')).toBe('trust_for_life')
  })

  it('returns null when nothing is set rather than defaulting to staged', () => {
    expect(descendantsDistributionMethod(null, null)).toBeNull()
  })

  it('returns null for a value that is not a residual beneficiary method', () => {
    expect(descendantsDistributionMethod(null, 'per stirpes')).toBeNull()
  })

  it('prefers trust_details over the column', () => {
    expect(descendantsDistributionMethod('outright', 'staggered')).toBe('outright')
  })
})
