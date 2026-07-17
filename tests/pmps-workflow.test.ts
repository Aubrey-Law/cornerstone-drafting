import { describe, expect, it } from 'vitest'
import type { DraftPayload } from '@/lib/draftPayload/types'
import { assemblePmpsData } from '@/lib/pmps/assemble'
import { generatePmpsArtifacts } from '@/lib/pmps/generate'
import { ANNUAL_GIFT_EXCLUSION_2026, FEDERAL_BASIC_EXCLUSION_2026, computeMaEstateTax, computePmpsTax } from '@/lib/pmps/tax'

function payload(overrides: Partial<DraftPayload> = {}): DraftPayload {
  return {
    matter: { id: '11111111-1111-4111-8111-111111111111', matter_number: 'EP-100', type: 'married_joint', trust_type: 'revocable_living', practice_area: 'Estate Planning', minor_children: false },
    client: { first_name: 'Alex', last_name: 'Chen', full_name: 'Alex Chen', aka: null, preferred_pronoun: null, citizenship: 'US', dob: '1970-01-01', address: '1 Main St', city: 'Needham', county: 'Norfolk', state: 'MA', zip: '02492', email: null, phone: null, excluded_guardian: null },
    spouse: { first_name: 'Jamie', last_name: 'Chen', full_name: 'Jamie Chen', aka: null, preferred_pronoun: null, citizenship: 'US', dob: '1971-01-01' },
    marriage: { date: '1998-06-15' },
    children: [{ full_name: 'Taylor Chen', dob: '2000-01-01', relationship: 'biological', minor: false }],
    trust: null,
    trust_provisions: {} as DraftPayload['trust_provisions'],
    fiduciaries: { pr_primary: 'Jamie Chen', dpoa_primary: 'Jamie Chen', hcp_primary: 'Jamie Chen', trustee_initial: 'Alex and Jamie Chen', trustee_successor: 'Taylor Chen', spouse_pr_primary: 'Alex Chen', spouse_dpoa_primary: 'Alex Chen', spouse_hcp_primary: 'Alex Chen', spouse_trustee_successor: 'Taylor Chen' } as DraftPayload['fiduciaries'],
    documents: { include_trust: true, include_pour_over_will: true, include_simple_will: false, include_testamentary_trust_will: false, include_dpoa: true, include_hcp: true, include_hipaa: true, include_ahd: true, include_ppm: false, include_parental_appointment: false, include_temp_delegation: false, spouse_docs: true, trust_planning_type: 'clayton_election' } as unknown as DraftPayload['documents'],
    will_provisions: {} as DraftPayload['will_provisions'], dpoa_provisions: {} as DraftPayload['dpoa_provisions'], hcp_provisions: {} as DraftPayload['hcp_provisions'], hipaa_provisions: {} as DraftPayload['hipaa_provisions'],
    assets: [{ category: 'real_property', description: 'Residence', institution: null, estimated_value: 2_000_000, notes: null, from_intake: true }, { category: 'retirement', description: 'Retirement accounts', institution: null, estimated_value: 4_500_000, notes: null, from_intake: true }],
    ...overrides,
  } as unknown as DraftPayload
}

describe('PMPS tax calculation', () => {
  it('uses current verified 2026 federal constants', () => {
    expect(ANNUAL_GIFT_EXCLUSION_2026).toBe(19_000)
    expect(FEDERAL_BASIC_EXCLUSION_2026).toBe(15_000_000)
  })

  it('returns zero at the Massachusetts exclusion and applies credit above it', () => {
    expect(computeMaEstateTax(2_000_000).netTax).toBe(0)
    expect(computeMaEstateTax(2_500_000).netTax).toBeGreaterThan(0)
  })

  it('computes a lower selected-plan scenario only for credit-shelter structures', () => {
    expect(computePmpsTax(6_500_000, 'separate_clayton').savings).toBeGreaterThan(0)
    expect(computePmpsTax(6_500_000, 'joint_disclaimer').withPlanning).not.toBeNull()
    expect(computePmpsTax(6_500_000, 'joint_outright').withPlanning).toBeNull()
  })
})

describe('PMPS assembly and generation', () => {
  it('blocks missing attorney decisions and incomplete assets', () => {
    const result = assemblePmpsData(payload({ assets: [{ category: 'other', description: 'Unvalued asset', institution: null, estimated_value: null, notes: null, from_intake: true }] }), {})
    expect(result.data).toBeNull()
    expect(result.preflight.map(issue => issue.field)).toEqual(expect.arrayContaining(['hasLegalPlan', 'planStructure', 'assets']))
    expect(result.preflight.every(issue => issue.message.includes('[UNKNOWN]') || issue.field === 'planStructure')).toBe(true)
  })

  it('rejects a couple/individual structure contradiction', () => {
    const result = assemblePmpsData(payload(), { hasLegalPlan: true, planStructure: 'individual_single' })
    expect(result.data).toBeNull()
    expect(result.preflight.some(issue => issue.message.includes('conflicts'))).toBe(true)
  })

  it('generates four non-empty Word artifacts in memory', async () => {
    const assembled = assemblePmpsData(payload(), { hasLegalPlan: true, legalPlanName: 'MetLife', planStructure: 'separate_clayton' })
    expect(assembled.preflight).toEqual([])
    const artifacts = await generatePmpsArtifacts(assembled.data!, assembled.selectedKinds)
    expect(artifacts).toHaveLength(4)
    expect(new Set(artifacts.map(artifact => artifact.filename)).size).toBe(4)
    for (const artifact of artifacts) {
      expect(artifact.bytes.subarray(0, 2).toString()).toBe('PK')
      expect(artifact.bytes.byteLength).toBeGreaterThan(5_000)
    }
  })

  it('supports explicit document exclusion', () => {
    const assembled = assemblePmpsData(payload(), { hasLegalPlan: false, flatFee: 3_500, planStructure: 'joint_outight' as never, documentKinds: ['proposal'] })
    expect(assembled.data).toBeNull()
    const valid = assemblePmpsData(payload(), { hasLegalPlan: false, flatFee: 3_500, planStructure: 'joint_outright', documentKinds: ['proposal'] })
    expect(valid.selectedKinds).toEqual(['proposal'])
  })
})
