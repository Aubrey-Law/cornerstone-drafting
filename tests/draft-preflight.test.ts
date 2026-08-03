import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadTrustProvisions } from '@/lib/buildDraftPayload'
import { defaultDraftPayloadDpoaProvisions } from '@/lib/draftPayload/defaults'
import { buildEstateDraftPreflight } from '@/lib/estateGenerator/preflight'

function payload(overrides: {
  matter?: Partial<DraftPayload['matter']>
  client?: Partial<DraftPayload['client']>
  spouse?: Partial<NonNullable<DraftPayload['spouse']>> | null
  children?: DraftPayload['children']
  documents?: Partial<DraftPayload['documents']>
  fiduciaries?: Partial<DraftPayload['fiduciaries']>
  trust?: Partial<NonNullable<DraftPayload['trust']>> | null
  will_provisions?: Partial<DraftPayload['will_provisions']>
  execution?: Partial<DraftPayload['execution']>
} = {}): DraftPayload {
  const base: DraftPayload = {
    matter: {
      id: 'matter-preflight-1',
      matter_number: 'EP-PREFLIGHT-1',
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
      trustee_second_successor: 'Morgan Trustee',
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
      spouse_trustee_successor: 'Morgan Trustee',
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
    design_sheet_id: 'sheet-preflight-1',
    special_provisions: null,
    ancillary_docs: [],
    notes: null,
  }

  return {
    ...base,
    matter: { ...base.matter, ...overrides.matter },
    client: { ...base.client, ...overrides.client },
    execution: { ...base.execution, ...overrides.execution },
    children: overrides.children ?? base.children,
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
    will_provisions: { ...base.will_provisions, ...overrides.will_provisions },
    trust: overrides.trust === null ? null : { ...base.trust!, ...overrides.trust },
  }
}

describe('estate draft preflight', () => {
  it('does not import the full DOCX generator into the preflight route path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/estateGenerator/preflight.ts'), 'utf8')

    expect(source).toContain("from '@/lib/estateGenerator/node/support'")
    expect(source).not.toContain("from '@/lib/estateGenerator/node/generate'")
  })

  it('reports Node packages, generated DOCX files, warnings, and unsupported selections before saving drafts', () => {
    const preflight = buildEstateDraftPreflight(payload())

    expect(preflight.engine).toBe('node')
    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual([
      'trust-individual-single',
      'pourover-will',
      'incapacity-documents',
      'personal-property-memorandum',
      'estate-plan-summary',
    ])
    expect(preflight.nodePackageNames).toEqual(preflight.packageNames)
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.unsupportedDocumentLabels).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-individual-single-revocable-trust.docx',
      '01-pourover-will.docx',
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
      '01-personal-property-memorandum.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.warnings).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Personal property memorandum.',
    )
  })

  it('accepts Massachusetts as the client state when preflighting', () => {
    const base = payload()
    const preflight = buildEstateDraftPreflight({
      ...base,
      client: { ...base.client, state: 'Massachusetts' },
    })

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
  })

  it('flags missing required generator fields but still allows generation (rendered as markers)', () => {
    const preflight = buildEstateDraftPreflight(payload({ trust: null }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.missing).toContain('trust.name')
  })

  it('preflights a simple will-only package before saving drafts', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
    }))

    expect(preflight.engine).toBe('node')
    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(preflight.nodePackageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.unsupportedDocumentLabels).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-last-will-and-testament.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.warnings).not.toContain(
      'Selected documents are not yet backed by estate generator packages: Simple will.',
    )
  })

  it('allows a testamentary trust will-only package once the template exists', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_successor: 'Morgan Backup Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
        trust_protector_name: null,
      },
    }))

    expect(preflight.engine).toBe('node')
    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(preflight.nodePackageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.unsupportedDocumentLabels).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-testamentary-trust-will.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.error).toBeUndefined()
  })

  it('preflights spouse companion testamentary trust wills as separate client and spouse drafts', () => {
    const preflight = buildEstateDraftPreflight(payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
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
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual([
      'testamentary-trust-will',
      'spouse-testamentary-trust-will',
      'estate-plan-summary',
    ])
    expect(preflight.nodePackageNames).toEqual(preflight.packageNames)
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-testamentary-trust-will.docx',
      '02-spouse-testamentary-trust-will.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.warnings).not.toContain(
      'Spouse companion testamentary trust wills are not generated separately yet; generation is blocked until spouse package support exists.',
    )
    expect(preflight.error).toBeUndefined()
  })

  it('preflights spouse companion pour-over and incapacity drafts as separate files', () => {
    const preflight = buildEstateDraftPreflight(payload({
      matter: { type: 'married_joint' },
      spouse: {
        first_name: 'John',
        last_name: 'Example',
        full_name: 'John Example',
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
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual([
      'pourover-will',
      'spouse-pourover-will',
      'incapacity-documents',
      'spouse-incapacity-documents',
      'estate-plan-summary',
    ])
    expect(preflight.nodePackageNames).toEqual(preflight.packageNames)
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-pourover-will.docx',
      '02-spouse-pourover-will.docx',
      '01-durable-power-of-attorney.docx',
      '02-health-care-proxy.docx',
      '03-living-will.docx',
      '04-hipaa-authorization.docx',
      '05-spouse-durable-power-of-attorney.docx',
      '06-spouse-health-care-proxy.docx',
      '07-spouse-living-will.docx',
      '08-spouse-hipaa-authorization.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.warnings).not.toContain(
      'Spouse companion pour-over wills and incapacity documents are not generated separately yet; review the output before relying on it as a complete married-couple package.',
    )
    expect(preflight.error).toBeUndefined()
  })

  it('preflights parental guardian appointment drafts as separate files', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
        include_temp_delegation: false,
      },
      fiduciaries: {
        guardian_primary: 'Grace Guardian',
        guardian_successor: 'Backup Guardian',
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.packageNames).toEqual(['parental-guardian-appointment', 'estate-plan-summary'])
    expect(preflight.nodePackageNames).toEqual(['parental-guardian-appointment', 'estate-plan-summary'])
    expect(preflight.fallbackPackageNames).toEqual([])
    expect(preflight.unsupportedDocumentLabels).toEqual([])
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual([
      '01-parental-appointment-of-guardian.docx',
      '00-estate-plan-summary.docx',
    ])
    expect(preflight.missing).toEqual([])
    expect(preflight.error).toBeUndefined()
  })

  it('lists selected asset-transfer documents alongside estate packages', () => {
    const preflight = buildEstateDraftPreflight(payload({
      documents: {
        include_deed: true,
        include_trustees_certificate: true,
        include_real_estate_trust: false,
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.documentsToGenerate.map(document => document.filename)).toEqual(expect.arrayContaining([
      'Deed.docx',
      'Trustees-Certificate.docx',
      '00-estate-plan-summary.docx',
    ]))
    expect(preflight.documentsToGenerate.map(document => document.filename)).not.toContain('Real-Estate-Trust.docx')
  })

  it('flags missing minor-child guardian data on a simple will preflight without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
      matter: { minor_children: true },
      trust: null,
      fiduciaries: { guardian_primary: null },
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
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(preflight.missing).toEqual(['guardians.primary.full_name'])
  })

  it('flags missing named outright residuary beneficiary data without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
        outright_residuary_named: null,
        outright_residuary_alternate: null,
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(preflight.missing).toEqual([
      'outright_will.residuary.named.full_name',
      'outright_will.residuary.alternate.full_name',
    ])
  })

  it('flags a missing co-personal representative without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
      fiduciaries: {
        pr_primary: 'Emily Executor',
      },
      will_provisions: {
        pr_structure: 'co_pr',
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['simple-will', 'estate-plan-summary'])
    expect(preflight.missing).toEqual(['fiduciaries.executor.co_primary.full_name'])
  })

  it('flags missing minor-child guardian data on a testamentary trust will without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
      matter: { minor_children: true },
      trust: null,
      fiduciaries: {
        guardian_primary: null,
        trustee_initial: 'Taylor Testamentary Trustee',
      },
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
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(preflight.missing).toContain('guardians.primary.full_name')
  })

  it('flags a missing testamentary trustee without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
      trust: null,
      fiduciaries: { trustee_initial: null },
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
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(preflight.missing).toContain('fiduciaries.testamentary_trustee.primary.full_name')
  })

  it('flags a missing co-trustee without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
      trust: null,
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
        trustee_co: null,
      },
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
        trustee_structure: 'co_trustees',
        cotrustee_decision_standard: 'unanimous',
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.packageNames).toEqual(['testamentary-trust-will', 'estate-plan-summary'])
    expect(preflight.missing).toContain('fiduciaries.testamentary_trustee.co_primary.full_name')
  })

  it('flags incomplete single-beneficiary data without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'single_beneficiary',
        single_beneficiary_name: null,
        single_beneficiary_remainder: null,
        trust_protector: false,
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.missing).toEqual([
      'testamentary_trust.single_beneficiary.full_name',
      'testamentary_trust.remainder_beneficiary.full_name',
    ])
  })

  it('clears the spouse co-personal-representative once one is assigned', () => {
    const base = {
      matter: { type: 'married_joint' as const },
      spouse: { first_name: 'John', last_name: 'Example', full_name: 'John Example' },
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
        spouse_docs: true,
      },
      will_provisions: { pr_structure: 'co_pr' as const },
    }

    const withoutSpouseCoPr = buildEstateDraftPreflight(payload({
      ...base,
      fiduciaries: { pr_co_primary: 'Cody Executor', spouse_pr_primary: 'Spencer Spouse Executor' },
    }))

    // The client's co-PR is filled in, so only the spouse's will is short — and
    // the checklist has to say so, or it reads as the client's field being blank.
    expect(withoutSpouseCoPr.missing).toEqual(['fiduciaries.executor.co_primary.full_name'])
    expect(withoutSpouseCoPr.missingFields).toEqual([
      {
        path: 'fiduciaries.executor.co_primary.full_name',
        packageName: 'spouse-pourover-will',
        subjectKind: 'spouse',
        subjectName: 'John Example',
      },
    ])

    const withSpouseCoPr = buildEstateDraftPreflight(payload({
      ...base,
      fiduciaries: {
        pr_co_primary: 'Cody Executor',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_pr_co_primary: 'Sydney Spouse Executor',
      },
    }))

    expect(withSpouseCoPr.missing).toEqual([])
    expect(withSpouseCoPr.missingFields).toEqual([])
  })

  it('clears the spouse co-testamentary-trustee once one is assigned', () => {
    const base = {
      matter: { type: 'married_joint' as const },
      spouse: { first_name: 'John', last_name: 'Example', full_name: 'John Example' },
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
      will_provisions: {
        trustee_structure: 'co_trustees' as const,
        beneficiary_structure: 'descendants_per_stirpes' as const,
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: false,
      },
    }

    const withoutSpouseCoTrustee = buildEstateDraftPreflight(payload({
      ...base,
      fiduciaries: {
        trustee_initial: 'Taylor Trustee',
        trustee_co: 'Casey Trustee',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_trustee_successor: 'Skyler Spouse Trustee',
      },
    }))

    expect(withoutSpouseCoTrustee.missing).toEqual([
      'fiduciaries.testamentary_trustee.co_primary.full_name',
    ])
    expect(withoutSpouseCoTrustee.missingFields.map(field => field.subjectKind)).toEqual(['spouse'])

    const withSpouseCoTrustee = buildEstateDraftPreflight(payload({
      ...base,
      fiduciaries: {
        trustee_initial: 'Taylor Trustee',
        trustee_co: 'Casey Trustee',
        spouse_pr_primary: 'Spencer Spouse Executor',
        spouse_trustee_successor: 'Skyler Spouse Trustee',
        spouse_trustee_co: 'Sasha Spouse Trustee',
      },
    }))

    expect(withSpouseCoTrustee.missing).toEqual([])
  })

  it('attributes a blank young-adult field to the child it belongs to', () => {
    const preflight = buildEstateDraftPreflight(payload({
      client: { county: null },
      trust: null,
      children: [
        { full_name: 'Alex Example', dob: '2005-01-01', relationship: 'biological', minor: false },
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
        include_young_adult_estate_plan: true,
      },
      execution: { signing_county: null },
    }))

    const youngAdultFields = preflight.missingFields.filter(
      field => field.packageName === 'young-adult-estate-plan',
    )

    expect(youngAdultFields.length).toBeGreaterThan(0)
    expect(youngAdultFields.every(field => field.subjectKind === 'young-adult')).toBe(true)
    expect(youngAdultFields.every(field => field.subjectName === 'Alex Example')).toBe(true)
  })

  it('flags an unnamed requested trust protector without blocking', () => {
    const preflight = buildEstateDraftPreflight(payload({
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
      fiduciaries: {
        trustee_initial: 'Taylor Testamentary Trustee',
      },
      will_provisions: {
        beneficiary_structure: 'descendants_per_stirpes',
        age_distribution_schedule: 'staggered_25_30_35',
        trust_protector: true,
        trust_protector_name: null,
      },
    }))

    expect(preflight.canGenerate).toBe(true)
    expect(preflight.error).toBeUndefined()
    expect(preflight.missing).toEqual(['testamentary_trust.trust_protector.full_name'])
  })
})
