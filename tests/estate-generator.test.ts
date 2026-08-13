import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadTrustProvisions } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadDpoaProvisions } from '@/lib/draftPayload/defaults'
import {
  deriveEstateGeneratorPackage,
  deriveEstateGeneratorPackages,
  estateGeneratorBlockingError,
  estateGeneratorCoverageWarnings,
  toEstateGeneratorData,
} from '@/lib/estateGenerator/toGeneratorData'

type DraftPayloadOverride = Partial<
  Omit<DraftPayload, 'matter' | 'client' | 'spouse' | 'documents' | 'fiduciaries' | 'trust' | 'will_provisions'>
> & {
  matter?: Partial<DraftPayload['matter']>
  client?: Partial<DraftPayload['client']>
  spouse?: Partial<NonNullable<DraftPayload['spouse']>> | null
  documents?: Partial<DraftPayload['documents']>
  fiduciaries?: Partial<DraftPayload['fiduciaries']>
  trust?: Partial<NonNullable<DraftPayload['trust']>> | null
  will_provisions?: Partial<DraftPayload['will_provisions']>
}

function payload(overrides: DraftPayloadOverride = {}): DraftPayload {
  const base: DraftPayload = {
    matter: {
      id: 'matter-1',
      matter_number: 'EP-1',
      type: 'individual',
      trust_type: 'revocable_living',
      practice_area: 'Estate Planning',
      minor_children: false,
    },
    client: {
      first_name: 'Jane',
      last_name: 'Example',
      full_name: 'Jane Example',
      aka: null,
      preferred_pronoun: null,
      dob: '1970-01-01',
      address: '123 Main Street',
      city: 'Boston',
      county: 'Suffolk',
      state: 'MA',
      zip: '02108',
      email: 'jane@example.com',
      phone: '555-0100',
      excluded_guardian: null,
    },
    spouse: null,
    children: [],
    family_provisions: {
      include_child_gender_markers: false,
      include_afterborn_children: true,
      include_expectant_children: true,
      omissions_intentional: false,
      include_general_disinheritance: true,
      disinherit_issue: false,
      additional_disinheritance_language: null,
      disinherited: [],
    },
    trust: {
      name: 'Jane Example Revocable Living Trust',
      spouse_name: null,
      display_name: 'Jane Example Revocable Living Trust',
      spouse_display_name: null,
      date: '2026-05-31',
      distribution_ages: [25, 30, 35],
      ma_estate_taxable: false,
      ma_estate_tax_savings: null,
      separate_trusts: false,
      has_ilit: false,
      ilit_trustee: null,
    },
    trust_provisions: defaultDraftPayloadTrustProvisions(),
    fiduciaries: {
      pr_primary: 'Pat Executor',
      pr_co_primary: null,
      pr_successor: 'Sam Successor',
      pr_co_successor: null,
      pr_second_successor: null,
      dpoa_primary: 'Alex Agent',
      dpoa_co_agent: null,
      dpoa_successor: 'Casey Agent',
      hcp_primary: 'Harper Proxy',
      hcp_primary_address: '1 Care Way',
      hcp_primary_relationship: 'Spouse',
      hcp_successor: 'Riley Proxy',
      hcp_successor_address: '2 Care Way',
      hcp_successor_relationship: 'Sibling',
      trustee_initial: 'Jane Example',
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
      include_dpoa: true,
      include_hcp: true,
      include_hipaa: true,
      include_ahd: true,
      include_ppm: true,
      include_parental_appointment: false,
      include_temp_delegation: false,
      spouse_docs: false,
      trust_planning_type: 'standard',
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
      single_beneficiary_name: 'Jordan Beneficiary',
      single_beneficiary_remainder: 'Morgan Remainder',
      age_distribution_schedule: 'staggered_25_30_35',
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
      signing_month: 'May',
      signing_year: '2026',
      signing_county: 'Suffolk',
      notary_commission_expiration: '2030-01-01',
    },
    design_sheet_id: 'sheet-1',
    special_provisions: null,
    ancillary_docs: [],
    notes: null,
  }

  return {
    ...base,
    ...overrides,
    matter: { ...base.matter, ...overrides.matter },
    client: { ...base.client, ...overrides.client },
    spouse: overrides.spouse === undefined
      ? base.spouse
      : overrides.spouse === null
        ? null
        : {
            first_name: '',
            last_name: '',
            full_name: '',
            aka: null,
            preferred_pronoun: null,
            dob: null,
            ...overrides.spouse,
          },
    documents: { ...base.documents, ...overrides.documents },
    fiduciaries: { ...base.fiduciaries, ...overrides.fiduciaries },
    trust: overrides.trust === null ? null : { ...base.trust!, ...overrides.trust },
    will_provisions: { ...base.will_provisions, ...overrides.will_provisions },
  }
}

describe('estate generator mapping', () => {
  it('routes individual trust matters to the individual trust package', () => {
    expect(deriveEstateGeneratorPackage(payload())).toBe('trust-individual-single')
  })

  it('routes joint trust matters to the joint trust package', () => {
    expect(
      deriveEstateGeneratorPackage(payload({
        matter: { type: 'married_joint' },
        spouse: {
          first_name: 'John',
          last_name: 'Example',
          full_name: 'John Example',
          aka: null,
          dob: null,
        },
      })),
    ).toBe('joint-trust')
  })

  it('routes a married-individual disclaimer trust to the disclaimer trust package', () => {
    expect(
      deriveEstateGeneratorPackage(payload({
        matter: { type: 'married_individual' },
        documents: { trust_planning_type: 'disclaimer' },
      })),
    ).toBe('indv-disclaimer-trust')
  })

  it('keeps the standard individual trust when the disclaimer structure is not selected', () => {
    expect(
      deriveEstateGeneratorPackage(payload({
        matter: { type: 'married_individual' },
        documents: { trust_planning_type: 'standard' },
      })),
    ).toBe('trust-individual-single')
  })

  it('never selects the disclaimer trust for an unmarried individual', () => {
    expect(
      deriveEstateGeneratorPackage(payload({
        matter: { type: 'individual' },
        documents: { trust_planning_type: 'disclaimer' },
      })),
    ).toBe('trust-individual-single')
  })

  it('routes full trust plans to every needed estate generator package', () => {
    expect(deriveEstateGeneratorPackages(payload())).toEqual([
      'trust-individual-single',
      'pourover-will',
      'incapacity-documents',
      'personal-property-memorandum',
      'estate-plan-summary',
    ])
    expect(estateGeneratorCoverageWarnings(payload())).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Personal property memorandum.',
    )
  })

  it('routes simple will-only plans to the narrow simple will package', () => {
    const willOnly = payload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
      },
    })

    expect(deriveEstateGeneratorPackages(willOnly)).toEqual(['simple-will', 'estate-plan-summary'])
    expect(estateGeneratorCoverageWarnings(willOnly)).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Simple will.',
    )
  })

  it('builds outright will residuary data from the draft payload', () => {
    const data = toEstateGeneratorData(payload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: true,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
      },
      will_provisions: {
        outright_residuary: 'named',
        outright_residuary_named: 'Avery Outright Beneficiary',
        outright_residuary_alternate: 'Casey Alternate Beneficiary',
      },
    }))

    expect(data.outright_will).toMatchObject({
      residuary: {
        disposition: 'named',
        named: { full_name: 'Avery Outright Beneficiary' },
        alternate: { full_name: 'Casey Alternate Beneficiary' },
      },
    })
  })

  it('projects design-summary identity, marriage, ZIP, and asset fields', () => {
    const data = toEstateGeneratorData(payload({
      client: { zip: '02108' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: 'Johnny Example',
        preferred_pronoun: null,
        dob: '1972-02-02',
      },
      marriage: { date: '2001-06-15' },
      assets: [
        { category: 'financial', description: 'Checking', institution: null, estimated_value: 125000, notes: null, from_intake: true },
        { category: 'real_property', description: 'Home', institution: null, estimated_value: 875000, notes: null, from_intake: true },
      ],
    }))

    expect(data.client.zip).toBe('02108')
    expect(data.spouse?.aka).toBe('Johnny Example')
    expect(data.marriage?.date).toBe('June 15, 2001')
    expect(data.assets.total_gross_value).toBe('$1,000,000')
  })

  it('builds will personal representative and administration data from the draft payload', () => {
    const data = toEstateGeneratorData(payload({
      fiduciaries: {
        pr_primary: 'Emily Executor',
        pr_co_primary: 'Cameron Co-Executor',
        pr_successor: 'Samuel Successor',
        pr_second_successor: 'Riley Second Successor',
      },
      will_provisions: {
        pr_structure: 'co_pr',
        bond: 'required',
        supervision: 'supervised',
      },
    }))

    expect(data.fiduciaries).toMatchObject({
      executor: {
        primary: { full_name: 'Emily Executor' },
        co_primary: { full_name: 'Cameron Co-Executor' },
        successor: { full_name: 'Samuel Successor' },
        second_successor: { full_name: 'Riley Second Successor' },
      },
    })
    expect(data.will).toMatchObject({
      pr_structure: 'co_pr',
      bond: 'required',
      supervision: 'supervised',
    })
  })

  it('builds common will provision controls from the draft payload', () => {
    const data = toEstateGeneratorData(payload({
      will_provisions: {
        no_contest_clause: 'include',
        include_disclaimer_article: false,
        include_self_proving_affidavit: false,
      },
    }))

    expect(data.will).toMatchObject({
      no_contest_clause: 'include',
      include_disclaimer_article: false,
      include_self_proving_affidavit: false,
    })
  })

  it('builds client AKA and excluded guardian data from the draft payload', () => {
    const data = toEstateGeneratorData(payload({
      client: {
        aka: 'Janie Example',
        excluded_guardian: 'Jordan Unsafe Guardian',
      },
    }))

    expect(data.client).toMatchObject({
      full_name: 'Jane Example',
      aka: 'Janie Example',
    })
    expect(data.guardians).toMatchObject({
      excluded: [{ full_name: 'Jordan Unsafe Guardian' }],
    })
  })

  it('maps family disinheritance selections to trust.disinherited and family flags', () => {
    const data = toEstateGeneratorData(payload({
      children: [
        {
          full_name: 'Alex Example',
          dob: '2010-01-01',
          relationship: 'biological',
          parentage: 'client',
          gender: 'male',
          deceased: false,
          minor: true,
        },
      ],
      spouse: {
        first_name: 'Sam',
        last_name: 'Example',
        full_name: 'Sam Example',
        aka: null,
        preferred_pronoun: null,
        dob: null,
      },
      family_provisions: {
        include_child_gender_markers: true,
        include_afterborn_children: false,
        include_expectant_children: true,
        omissions_intentional: true,
        include_general_disinheritance: false,
        disinherit_issue: true,
        additional_disinheritance_language: 'No provision is made for estranged relatives.',
        disinherited: [
          { full_name: 'Alex Example', relationship: 'child' },
          { full_name: 'Jordan Rival', relationship: 'Sibling' },
        ],
      },
    }))

    expect(data.trust).toMatchObject({
      disinherited: [
        { full_name: 'Alex Example', relationship: 'child' },
        { full_name: 'Jordan Rival', relationship: 'Sibling' },
      ],
      disinherit_issue: true,
      blended_family: {
        client_children: [{ full_name: 'Alex Example' }],
        spouse_children: [],
      },
    })
    expect(data.family).toMatchObject({
      blended_family: true,
      include_child_gender_markers: true,
      include_afterborn_children: false,
      include_expectant_children: true,
      omissions_intentional: true,
      include_general_disinheritance: false,
      additional_disinheritance_language: 'No provision is made for estranged relatives.',
    })
    expect(data.children[0]).toMatchObject({
      full_name: 'Alex Example',
      gender_display: 'male',
    })
    expect(data.trust).not.toMatchObject({
      disinherited: [{ full_name: 'Jordan Unsafe Guardian' }],
    })
  })

  it('wires the second successor guardian through to guardians.second_successor', () => {
    const data = toEstateGeneratorData(payload({
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
        guardian_successor: 'Backup Guardian',
        guardian_second_successor: 'Final Guardian',
      },
    }))

    expect(data.guardians).toMatchObject({
      primary: { full_name: 'Grace Guardian' },
      successor: { full_name: 'Backup Guardian' },
      second_successor: { full_name: 'Final Guardian' },
    })
  })

  it('wires every trustee succession level, including co-trustees, from the client trustee fields', () => {
    const data = toEstateGeneratorData(payload({
      fiduciaries: {
        trustee_initial: 'Tracy Trustee',
        trustee_co: 'Casey Co-Trustee',
        trustee_successor: 'Sam Successor',
        trustee_co_successor: 'Sandy Co-Successor',
        trustee_second_successor: 'Theo Third',
        trustee_co_second_successor: 'Tara Co-Third',
        // Spouse trustee must NOT leak into the client trustee's third successor.
        spouse_trustee_successor: 'Spouse Trustee',
      },
    }))

    expect(data.fiduciaries.trustee).toMatchObject({
      primary: { full_name: 'Tracy Trustee' },
      co_primary: { full_name: 'Casey Co-Trustee' },
      successor: { full_name: 'Sam Successor' },
      co_successor: { full_name: 'Sandy Co-Successor' },
      second_successor: { full_name: 'Theo Third' },
      co_second_successor: { full_name: 'Tara Co-Third' },
    })
  })

  it('wires the co-successor personal representative from the client executor fields', () => {
    const data = toEstateGeneratorData(payload({
      fiduciaries: {
        pr_primary: 'Pat PR',
        pr_successor: 'Sam Successor',
        pr_co_successor: 'Casey Co-Successor',
      },
    }))

    expect(data.fiduciaries.executor).toMatchObject({
      primary: { full_name: 'Pat PR' },
      successor: { full_name: 'Sam Successor' },
      co_successor: { full_name: 'Casey Co-Successor' },
    })
  })

  it('builds client and spouse pronouns from intake selections', () => {
    const data = toEstateGeneratorData(payload({
      client: {
        preferred_pronoun: 'she/her',
      },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        preferred_pronoun: 'he/him',
      },
    }))

    expect(data.client).toMatchObject({
      pronoun_subject: 'she',
      pronoun_object: 'her',
      pronoun_possessive: 'her',
    })
    expect(data.spouse).toMatchObject({
      pronoun_subject: 'he',
      pronoun_object: 'him',
      pronoun_possessive: 'his',
    })
  })

  it('builds remaining all-wills provision data from the draft payload', () => {
    const data = toEstateGeneratorData(payload({
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        preferred_pronoun: null,
        dob: null,
      },
      will_provisions: {
        simultaneous_death: 'testator_survives',
        utma_age: 18,
        tangible_property_distribution: 'named_then_children',
        tangible_property_named_individual: 'Avery Tangible Recipient',
        pet_care_option: 'direct_bequest',
        pet_care_details: {
          cash_amount: 5000,
          primary_caretaker: 'Parker Pet Caretaker',
          successor_caretaker: 'Sawyer Pet Backup',
        },
        specific_bequests: [
          {
            id: 'cash-gift',
            kind: 'cash',
            amount: 10000,
            beneficiary_name: 'Blake Beneficiary',
          },
          {
            id: 'item-gift',
            kind: 'item',
            item_description: 'my grandfather clock',
            beneficiary_name: 'Quinn Recipient',
          },
          {
            id: 'charity-gift',
            kind: 'charitable',
            amount: 2500,
            charity_name: 'Boston Animal Rescue',
          },
        ],
      },
    }))

    expect(data.will).toMatchObject({
      simultaneous_death: 'testator_survives',
      utma_age: 18,
      tangible_personal_property: {
        distribution_method: 'named_then_children',
        named_individual: { full_name: 'Avery Tangible Recipient' },
      },
      pet_care: {
        option: 'direct_bequest',
        cash_amount: '$5,000',
        primary_caretaker: { full_name: 'Parker Pet Caretaker' },
        successor_caretaker: { full_name: 'Sawyer Pet Backup' },
      },
    })
    expect(data.specific_gifts).toEqual([
      { item: 'the sum of $10,000', recipient: 'Blake Beneficiary', beneficiary_name: 'Blake Beneficiary', description: 'the sum of $10,000' },
      { item: 'my grandfather clock', recipient: 'Quinn Recipient', beneficiary_name: 'Quinn Recipient', description: 'my grandfather clock' },
      { item: 'the sum of $2,500', recipient: 'Boston Animal Rescue', beneficiary_name: 'Boston Animal Rescue', description: 'the sum of $2,500' },
    ])
    expect(data.charitable_gifts).toEqual([
      { item: 'the sum of $2,500', recipient: 'Boston Animal Rescue', beneficiary_name: 'Boston Animal Rescue', description: 'the sum of $2,500' },
    ])
  })

  it('routes testamentary trust will-only plans to the narrow testamentary package', () => {
    const willOnly = payload({
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
        trust_protector_name: null,
      },
    })

    expect(deriveEstateGeneratorPackages(willOnly)).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(estateGeneratorCoverageWarnings(willOnly)).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Testamentary trust will.',
    )
  })

  it('routes spouse companion testamentary trust will packages to client and spouse outputs', () => {
    const marriedTestamentary = payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        dob: null,
      },
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        spouse_docs: true,
      },
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_trustee_successor: 'Skyler Spouse Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
      },
    })

    expect(deriveEstateGeneratorPackages(marriedTestamentary)).toEqual([
      'testamentary-trust-will',
      'spouse-testamentary-trust-will',
      'estate-plan-summary',
    ])
    expect(estateGeneratorBlockingError(marriedTestamentary)).toBeUndefined()
    expect(estateGeneratorCoverageWarnings(marriedTestamentary)).not.toContain(
      'Spouse companion testamentary trust wills are not generated separately yet; generation is blocked until spouse package support exists.',
    )
  })

  it('routes spouse companion pour-over and incapacity packages to separate outputs', () => {
    const marriedCompanionDocs = payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        dob: null,
      },
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: true,
        include_hcp: true,
        include_hipaa: true,
        include_ahd: true,
        include_ppm: false,
        spouse_docs: true,
      },
      fiduciaries: {
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_dpoa_primary: 'Sloane Spouse Agent',
        spouse_hcp_primary: 'Harper Spouse Proxy',
      },
    })

    expect(deriveEstateGeneratorPackages(marriedCompanionDocs)).toEqual([
      'pourover-will',
      'spouse-pourover-will',
      'incapacity-documents',
      'spouse-incapacity-documents',
      'estate-plan-summary',
    ])
    expect(estateGeneratorCoverageWarnings(marriedCompanionDocs)).not.toContain(
      'Spouse companion pour-over wills and incapacity documents are not generated separately yet; review the output before relying on it as a complete married-couple package.',
    )
  })

  it('marks pour-over-only plans as using revocable trust metadata', () => {
    const data = toEstateGeneratorData(payload({
      documents: {
        include_trust: false,
        include_pour_over_will: true,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        spouse_docs: false,
      },
    }))

    expect(data.planning.uses_revocable_trust).toBe(true)
    expect(data.trust.name).toBe('Jane Example Revocable Living Trust')
    expect(data.trust.date).toBe('May 31, 2026')
  })

  it('routes parental guardian appointments to a Node package while temporary delegation stays unsupported', () => {
    const minorChildDocs = payload({
      matter: { minor_children: true },
      children: [
        {
          full_name: 'Alex Example',
          dob: '2012-01-01',
          relationship: 'biological',
          minor: true,
        },
      ],
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: false,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        include_parental_appointment: true,
        include_temp_delegation: true,
      },
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
        guardian_successor: 'Backup Guardian',
      },
    })

    expect(deriveEstateGeneratorPackages(minorChildDocs)).toEqual([
      'parental-guardian-appointment',
      'temporary-delegation-parental-powers',
      'estate-plan-summary',
    ])
    expect(estateGeneratorCoverageWarnings(minorChildDocs)).toEqual([])
  })

  it('does not warn when selected guardian documents are backed by packages', () => {
    const warnings = estateGeneratorCoverageWarnings(payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        dob: null,
      },
      documents: {
        spouse_docs: true,
        include_parental_appointment: true,
        include_temp_delegation: true,
      },
    }))

    expect(warnings).toEqual([])
  })

  it('builds the JSON shape expected by the estate generator', () => {
    const data = toEstateGeneratorData(payload({
      fiduciaries: {
        hcp_co: 'Cal Care',
        hcp_co_address: '3 Health Ave',
        hcp_co_relationship: 'friend',
        hcp_successor_co: 'Dana Alternate Co',
        hcp_successor_co_address: '4 Health Ave',
        hcp_successor_co_relationship: 'colleague',
      },
    }))

    expect(data.client).toMatchObject({
      full_name: 'Jane Example',
      street_address: '123 Main Street',
      city: 'Boston',
      state: 'MA',
      county: 'Suffolk',
      date_of_birth: 'January 1, 1970',
    })
    expect(data.trust).toMatchObject({
      name: 'Jane Example Revocable Living Trust',
      date: 'May 31, 2026',
    })
    expect(data.fiduciaries.trustee).toMatchObject({
      primary: { full_name: 'Jane Example' },
      successor: { full_name: 'Taylor Trustee' },
    })
    expect(data.fiduciaries.executor).toMatchObject({
      primary: { full_name: 'Pat Executor' },
      co_primary: { full_name: '' },
      successor: { full_name: 'Sam Successor' },
      co_successor: { full_name: '' },
    })
    expect(data.healthcare.agent).toMatchObject({
      primary: { full_name: 'Harper Proxy', address: '1 Care Way' },
      co_primary: { full_name: 'Cal Care', address: '3 Health Ave', relationship: 'friend' },
      alternate: { full_name: 'Riley Proxy', address: '2 Care Way' },
      co_alternate: { full_name: 'Dana Alternate Co', address: '4 Health Ave', relationship: 'colleague' },
    })
    expect(data.execution).toMatchObject({
      signing_scheduled: true,
      signing_county: 'Suffolk',
      notary_commission: 'January 1, 2030',
    })
  })

  it('builds testamentary trust will data without defaulting the trustee to the client', () => {
    const data = toEstateGeneratorData(payload({
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
      },
      trust: null,
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_co: null,
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        single_beneficiary_name: null,
        single_beneficiary_remainder: null,
        trust_protector: true,
        trust_protector_name: 'Parker Protector',
      },
    }))

    expect(data.fiduciaries).toMatchObject({
      testamentary_trustee: {
        primary: { full_name: 'Taylor Testamentary Trustee' },
        successor: { full_name: 'Morgan Backup Trustee' },
      },
    })
    expect(data.testamentary_trust).toMatchObject({
      beneficiary_structure: 'descendants_per_stirpes',
      age_distribution_schedule: 'staggered_25_30_35',
      single_beneficiary: { full_name: '' },
      remainder_beneficiary: { full_name: '' },
      trust_protector_requested: true,
      trust_protector: { full_name: 'Parker Protector' },
    })

    const missingTrusteeData = toEstateGeneratorData(payload({
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
      },
      trust: null,
      fiduciaries: {
        trustee_initial: null,
        trustee_successor: 'Morgan Backup Trustee',
      },
    }))

    expect(missingTrusteeData.fiduciaries).toMatchObject({
      testamentary_trustee: {
        primary: { full_name: '' },
        successor: { full_name: 'Morgan Backup Trustee' },
      },
    })
    expect(
      (missingTrusteeData.fiduciaries.testamentary_trustee as { primary: { full_name: string } }).primary.full_name,
    ).not.toBe('Jane Example')
  })

  it('builds spouse testamentary will fiduciary data for companion generation', () => {
    const data = toEstateGeneratorData(payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        dob: '1972-02-02',
      },
      trust: null,
      documents: {
        include_trust: false,
        include_pour_over_will: false,
        include_simple_will: false,
        include_testamentary_trust_will: true,
        include_dpoa: false,
        include_hcp: false,
        include_hipaa: false,
        include_ahd: false,
        include_ppm: false,
        spouse_docs: true,
      },
      fiduciaries: {
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_pr_successor: 'Sawyer Spouse Successor',
        spouse_trustee_successor: 'Skyler Spouse Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
      },
    }))

    expect(data.spouse).toMatchObject({
      full_name: 'John Example',
      date_of_birth: 'February 2, 1972',
    })
    expect(data.fiduciaries).toMatchObject({
      spouse_executor: {
        primary: { full_name: 'Spencer Spouse Executor' },
        successor: { full_name: 'Sawyer Spouse Successor' },
      },
      spouse_testamentary_trustee: {
        primary: { full_name: 'Skyler Spouse Trustee' },
      },
    })
  })

  it('builds spouse agent and health care data for companion incapacity documents', () => {
    const data = toEstateGeneratorData(payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
        aka: null,
        dob: '1972-02-02',
      },
      documents: {
        spouse_docs: true,
      },
      fiduciaries: {
        spouse_dpoa_primary: 'Sloane Spouse Agent',
        spouse_dpoa_successor: 'Rowan Spouse Backup',
        spouse_hcp_primary: 'Harper Spouse Proxy',
        spouse_hcp_primary_address: '3 Care Lane',
        spouse_hcp_successor: 'Remy Spouse Alternate',
        spouse_hcp_successor_address: '4 Care Lane',
        spouse_hcp_co: 'Spouse Co Care',
        spouse_hcp_co_address: '5 Spouse Care Lane',
        spouse_hcp_co_relationship: 'parent',
        spouse_hcp_successor_co: 'Spouse Co Alternate',
        spouse_hcp_successor_co_address: '6 Spouse Co Lane',
        spouse_hcp_successor_co_relationship: 'sibling',
      },
    }))

    expect(data.fiduciaries).toMatchObject({
      spouse_agent: {
        primary: { full_name: 'Sloane Spouse Agent' },
        successor: { full_name: 'Rowan Spouse Backup' },
      },
    })
    expect(data.healthcare).toMatchObject({
      spouse_agent: {
        primary: {
          full_name: 'Harper Spouse Proxy',
          address: '3 Care Lane',
        },
        co_primary: {
          full_name: 'Spouse Co Care',
          address: '5 Spouse Care Lane',
          relationship: 'parent',
        },
        alternate: {
          full_name: 'Remy Spouse Alternate',
          address: '4 Care Lane',
        },
        co_alternate: {
          full_name: 'Spouse Co Alternate',
          address: '6 Spouse Co Lane',
          relationship: 'sibling',
        },
      },
    })
  })

  it('keeps unnamed minor-child signals separate from named children', () => {
    const data = toEstateGeneratorData(payload({
      matter: { minor_children: true },
    }))

    expect(data.children).toEqual([])
    expect(data.planning).toMatchObject({
      has_minor_children: true,
    })
  })

  it('maps named design-sheet children into generator child records', () => {
    const data = toEstateGeneratorData(payload({
      matter: { minor_children: true },
      children: [
        {
          full_name: 'Alex Example',
          dob: '2012-01-01',
          relationship: 'biological',
          minor: true,
        },
        {
          full_name: 'Blake Example',
          dob: null,
          relationship: 'adopted',
          minor: false,
        },
        {
          full_name: '',
          dob: '2015-01-01',
          relationship: 'stepchild',
          minor: true,
        },
      ],
    }))

    expect(data.children).toEqual([
      {
        full_name: 'Alex Example',
        date_of_birth: 'January 1, 2012',
        dob: '2012-01-01',
        relationship: 'biological',
        parentage: '',
        gender: '',
        gender_display: '',
        deceased: false,
        minor: true,
        young_adult_estate_plan: false,
      },
      {
        full_name: 'Blake Example',
        date_of_birth: '',
        dob: '',
        relationship: 'adopted',
        parentage: '',
        gender: '',
        gender_display: '',
        deceased: false,
        minor: false,
        young_adult_estate_plan: false,
      },
    ])
    expect(data.planning).toMatchObject({
      has_minor_children: true,
    })
  })

  it('passes client county to the estate generator separately from signing county', () => {
    const data = toEstateGeneratorData(payload({
      client: {
        first_name: 'Jane',
        last_name: 'Example',
        full_name: 'Jane Example',
        aka: null,
        dob: '1970-01-01',
        address: '123 Main Street',
        city: 'Boston',
        county: 'Middlesex',
        state: 'MA',
        zip: '02108',
        email: 'jane@example.com',
        phone: '555-0100',
        excluded_guardian: null,
      },
      execution: {
        signing_month: 'May',
        signing_year: '2026',
        signing_county: 'Suffolk',
        notary_commission_expiration: '2030-01-01',
      },
    }))

    expect(data.client).toMatchObject({
      county: 'Middlesex',
      signing_county: 'Suffolk',
    })
    expect(data.execution).toMatchObject({
      signing_county: 'Suffolk',
    })
  })

  it('marks execution data scheduled when only a notary commission expiration is known', () => {
    const data = toEstateGeneratorData(payload({
      execution: {
        signing_month: null,
        signing_year: null,
        signing_county: null,
        notary_commission_expiration: '2030-01-01',
      },
    }))

    expect(data.execution).toMatchObject({
      signing_scheduled: true,
      notary_commission: 'January 1, 2030',
    })
    expect(data.execution).not.toHaveProperty('doc_date')
    expect(data.execution).not.toHaveProperty('ordinal_doc_date')
    expect(data.execution).not.toHaveProperty('signing_county')
  })

  it('keeps a blank client date of birth key for strict HIPAA template rendering', () => {
    const data = toEstateGeneratorData(payload({
      client: {
        first_name: 'Jane',
        last_name: 'Example',
        full_name: 'Jane Example',
        aka: null,
        dob: null,
        address: '123 Main Street',
        city: 'Boston',
        county: 'Suffolk',
        state: 'MA',
        zip: '02108',
        email: 'jane@example.com',
        phone: '555-0100',
        excluded_guardian: null,
      },
    }))

    expect(data.client).toHaveProperty('date_of_birth', '')
  })

  it('loads county into the draft payload from design-sheet columns and decisions', () => {
    const assemble = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/assemble.ts'), 'utf8')
    const fields = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/designSheetFields.ts'), 'utf8')

    expect(fields).toContain('designSheetString')
    expect(assemble).toContain("designSheetString(designSheet, 'county')")
    expect(assemble).toContain("designSheetString(designSheet, 'signing_county')")
    expect(assemble).not.toContain('intake.county')
  })

  it('loads design-sheet children into the draft payload for generator output', () => {
    const types = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/types.ts'), 'utf8')
    const helpers = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/helpers.ts'), 'utf8')
    const assemble = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/assemble.ts'), 'utf8')

    expect(types).toContain('children?: DesignSheetChild[] | null')
    expect(helpers).toContain('export function draftPayloadChildren(')
    expect(helpers).toContain('designSheet?.children')
    expect(assemble).toContain('children: designChildren')
  })
})
