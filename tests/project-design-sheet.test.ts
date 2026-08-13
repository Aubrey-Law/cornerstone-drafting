import { describe, expect, it } from 'vitest'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadTrustProvisions } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadDpoaProvisions } from '@/lib/draftPayload/defaults'
import {
  projectDesignSheetToFlatSheet,
  projectDraftPayloadToFlatSheet,
} from '@/lib/drafting/projectDesignSheet'
import { buildClientVariables } from '@/lib/drafting/variables'

function payload(overrides: {
  matter?: Partial<DraftPayload['matter']>
  spouse?: Partial<NonNullable<DraftPayload['spouse']>> | null
  fiduciaries?: Partial<DraftPayload['fiduciaries']>
} = {}): DraftPayload {
  const base: DraftPayload = {
    matter: {
      id: 'matter-1',
      matter_number: 'EP-1',
      type: 'married_joint',
      trust_type: 'revocable_living',
      practice_area: 'Estate Planning',
      minor_children: false,
    },
    client: {
      first_name: 'John',
      last_name: 'Client',
      full_name: 'John Client',
      aka: null,
      preferred_pronoun: 'he/him',
      dob: '1970-01-01',
      address: '123 Main Street',
      city: 'Boston',
      county: 'Suffolk',
      state: 'MA',
      zip: '02108',
      email: 'john@example.com',
      phone: '555-0100',
      excluded_guardian: null,
    },
    spouse: {
      first_name: 'Jane',
      last_name: 'Client',
      full_name: 'Jane Client',
      aka: null,
      preferred_pronoun: 'she/her',
      dob: '1972-02-02',
    },
    children: [{ full_name: 'Kid Client', dob: '2010-03-03', relationship: null, minor: false }],
    trust: {
      name: 'THE CLIENT FAMILY REVOCABLE LIVING TRUST',
      spouse_name: null,
      display_name: 'THE CLIENT FAMILY REVOCABLE LIVING TRUST',
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
      pr_co_primary: 'Co Executor',
      pr_successor: 'Sam Successor',
      pr_co_successor: null,
      pr_second_successor: null,
      dpoa_primary: 'Alex Agent',
      dpoa_co_agent: 'Co Agent',
      dpoa_successor: 'Casey Agent',
      hcp_primary: 'Harper Proxy',
      hcp_primary_address: '1 Care Way',
      hcp_primary_relationship: 'Spouse',
      hcp_successor: 'Riley Proxy',
      hcp_successor_address: '2 Care Way',
      hcp_successor_relationship: 'Sibling',
      hcp_co: 'Casey Co-Proxy',
      hcp_co_relationship: 'Child',
      hcp_co_address: '3 Co-Care Way',
      hcp_successor_co: 'Alex Co-Alternate',
      hcp_successor_co_relationship: 'Colleague',
      hcp_successor_co_address: '4 Co-Care Way',
      trustee_initial: 'John Client',
      trustee_co: 'Jane Client',
      trustee_successor: 'Taylor Trustee',
      trustee_co_successor: 'Morgan Trustee',
      trustee_second_successor: null,
      trustee_co_second_successor: null,
      guardian_primary: 'Guard One',
      guardian_successor: 'Guard Two',
      guardian_second_successor: 'Guard Three',
      temp_guardian_primary: null,
      temp_guardian_co: null,
      temp_guardian_successor: null,
      temp_guardian_second_successor: null,
      spouse_pr_co_primary: null,
      spouse_pr_primary: 'Spouse PR',
      spouse_pr_successor: 'Spouse PR Alt',
      spouse_dpoa_primary: 'Spouse POA',
      spouse_dpoa_successor: 'Spouse POA Alt',
      guardian_co: 'Co Guard One',
      guardian_co_successor: 'Co Guard Two',
      spouse_hcp_primary: 'Spouse HCP',
      spouse_hcp_primary_address: '3 Care Way',
      spouse_hcp_primary_relationship: 'Spouse',
      spouse_hcp_successor: 'Spouse HCP Alt',
      spouse_hcp_successor_address: '4 Care Way',
      spouse_hcp_successor_relationship: 'Child',
      spouse_hcp_co: 'Spouse Co HCP',
      spouse_hcp_co_address: '5 Spouse Co Way',
      spouse_hcp_co_relationship: 'Parent',
      spouse_hcp_successor_co: 'Spouse Co Alternate',
      spouse_hcp_successor_co_address: '6 Spouse Co Way',
      spouse_hcp_successor_co_relationship: 'Sibling',
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
      spouse_docs: true,
      trust_planning_type: 'standard',
    },
    will_provisions: {
      pr_structure: null,
      trustee_structure: null,
      cotrustee_decision_standard: 'majority',
      bond: 'no_bond',
      supervision: 'unsupervised',
      simultaneous_death: null,
      utma_age: 21,
      no_contest_clause: 'omit',
      include_disclaimer_article: true,
      include_self_proving_affidavit: true,
      tangible_property_distribution: 'memorandum',
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
    matter: { ...base.matter, ...overrides.matter },
    spouse: overrides.spouse === undefined
      ? base.spouse
      : overrides.spouse === null
        ? null
        : { ...base.spouse!, ...overrides.spouse },
    fiduciaries: { ...base.fiduciaries, ...overrides.fiduciaries },
  }
}

describe('projectDraftPayloadToFlatSheet', () => {
  it('keeps unknown pronouns empty instead of fabricating gendered values', () => {
    const flat = projectDraftPayloadToFlatSheet(payload({
      spouse: { preferred_pronoun: null },
    }))
    const clientUnknown = projectDraftPayloadToFlatSheet({
      ...payload(),
      client: { ...payload().client, preferred_pronoun: null },
    })

    expect(flat.spouse_pronouns).toBe('')
    expect(clientUnknown.client_pronouns).toBe('')
  })

  it('maps slot-resolved fiduciaries to legacy flat placeholder keys', () => {
    const flat = projectDraftPayloadToFlatSheet(payload())

    expect(flat.hcp_client_agent).toBe('HARPER PROXY')
    expect(flat.hcp_client_alt1).toBe('RILEY PROXY')
    expect(flat.hcp_client_co).toBe('CASEY CO-PROXY')
    expect(flat.hcp_client_co_alt1).toBe('ALEX CO-ALTERNATE')
    expect(flat.personal_representative).toBe('PAT EXECUTOR')
    expect(flat.personal_representative_co).toBe('CO EXECUTOR')
    expect(flat.personal_representative_alt1).toBe('SAM SUCCESSOR')
    expect(flat.poa_client_primary).toBe('ALEX AGENT')
    expect(flat.poa_client_co).toBe('CO AGENT')
    expect(flat.poa_client_alt).toBe('CASEY AGENT')
    expect(flat.guardian).toBe('GUARD ONE')
    expect(flat.co_guardian).toBe('CO GUARD ONE')
    expect(flat.alt_guardian).toBe('GUARD TWO')
    expect(flat.co_alt_guardian).toBe('CO GUARD TWO')
    expect(flat.hcp_spouse_agent).toBe('SPOUSE HCP')
    expect(flat.hcp_spouse_co).toBe('SPOUSE CO HCP')
    expect(flat.hcp_spouse_co_alt1).toBe('SPOUSE CO ALTERNATE')
    expect(flat.personal_representative_spouse).toBe('SPOUSE PR')
  })

  it('feeds buildClientVariables with uppercase placeholder values', () => {
    const flat = projectDraftPayloadToFlatSheet(payload())
    const vars = buildClientVariables(flat)

    expect(vars['[PRIMARY HCP]']).toBe('HARPER PROXY')
    expect(vars['[CO PRIMARY HCP]']).toBe('CASEY CO-PROXY')
    expect(vars['[CO ALTERNATE 1 HCP]']).toBe('ALEX CO-ALTERNATE')
    expect(vars['[PERSONAL REPRESENTATIVE]']).toBe('PAT EXECUTOR')
    expect(vars['[CLIENT FULL NAME]']).toBe('JOHN CLIENT')
    expect(vars['[CHILD FULL NAME]']).toBe('KID CLIENT')
  })
})

describe('projectDesignSheetToFlatSheet', () => {
  it('keeps missing design-sheet pronouns empty', () => {
    const flat = projectDesignSheetToFlatSheet({
      designSheet: {
        client_name: 'Alex Example',
        spouse_name: 'Robin Example',
        marital_status: 'married',
        client_pronouns: null,
        spouse_pronouns: null,
      },
    })

    expect(flat.client_pronouns).toBe('')
    expect(flat.spouse_pronouns).toBe('')
  })

  it('uses legacy columns when fiduciaries are not supplied', () => {
    const flat = projectDesignSheetToFlatSheet({
      designSheet: {
        client_name: 'Legacy Client',
        spouse_name: 'Legacy Spouse',
        marital_status: 'married',
        hcp_primary: 'Legacy HCP',
        executor_primary: 'Legacy Executor',
        street: '1 Old Road',
        city: 'Cambridge',
        state: 'MA',
        zip: '02139',
        county: 'Middlesex',
      },
    })

    expect(flat.hcp_client_agent).toBe('LEGACY HCP')
    expect(flat.personal_representative).toBe('LEGACY EXECUTOR')
    expect(flat.client_name).toBe('Legacy Client')
  })

  it('prefers resolved fiduciaries over legacy columns', () => {
    const flat = projectDesignSheetToFlatSheet({
      designSheet: {
        client_name: 'Slot Client',
        hcp_primary: 'Legacy HCP',
        executor_primary: 'Legacy Executor',
      },
      fiduciaries: payload().fiduciaries,
    })

    expect(flat.hcp_client_agent).toBe('HARPER PROXY')
    expect(flat.personal_representative).toBe('PAT EXECUTOR')
  })
})
