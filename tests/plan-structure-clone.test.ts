import { describe, expect, it } from 'vitest'

import { extractPlanStructure, applyPlanStructure, PLAN_STRUCTURE_FIELDS } from '@/lib/designSheet/planStructureClone'
import type { DesignSheet } from '@/types/database'

// "Copy plan structure" must NEVER carry one client's identity data into
// another client's documents. These are the highest-risk fields.
const IDENTITY_FIELDS = [
  'client_name', 'client_dob', 'client_email', 'client_phone', 'spouse_name',
  'street', 'city', 'zip', 'children', 'assets',
  'trustee_slots', 'executor_slots', 'poa_slots', 'hcp_slots', 'guardian_slots',
  'trust_name', 'spouse_trust_name', 'goals_notes', 'concerns',
  'specific_bequests', 'disinherited_children', 'additional_beneficiaries',
  'dpoa_self_dealing_reviewer', 'excluded_guardian_name', 'overrides',
] as const

function sourceSheet(): DesignSheet {
  return {
    id: 'sheet-src',
    matter_id: 'matter-src',
    client_name: 'Prior Client',
    client_email: 'prior@example.com',
    spouse_name: 'Prior Spouse',
    trust_name: 'The Prior Client Trust',
    goals_notes: 'Private notes about the prior client',
    plan_type: 'pour_over',
    is_joint: true,
    distribution_method: 'staggered',
    stagger_age_1: 25,
    utma_age: 21,
    pr_structure: 'spouse_first',
    children: [{ name: 'Prior Kid' }],
    assets: [{ description: 'Prior house' }],
    trustee_slots: [{ id: 't1', contact_id: 'contact-1', is_co: false, order: 0 }],
    dpoa_self_dealing_reviewer: 'Prior Reviewer',
    decisions: {
      document_inclusions: { trust: true, will: true, dpoa: true, healthcare: false },
      dpoa_provisions: { all_basic_powers: true },
      trust_details: { protect_us_trust_status: true, special_trustee_instructions: 'Call the prior client first' },
      deed: { property_address: '1 Prior St' },
      funding_plan: { accounts: ['prior account'] },
      excluded_person: { name: 'Prior Uncle' },
    },
  } as unknown as DesignSheet
}

describe('extractPlanStructure', () => {
  it('copies structural fields', () => {
    const patch = extractPlanStructure(sourceSheet())
    expect(patch.plan_type).toBe('pour_over')
    expect(patch.is_joint).toBe(true)
    expect(patch.distribution_method).toBe('staggered')
    expect(patch.stagger_age_1).toBe(25)
    expect(patch.pr_structure).toBe('spouse_first')
  })

  it('never copies identity data, people, assets, or notes', () => {
    const patch = extractPlanStructure(sourceSheet()) as Record<string, unknown>
    for (const field of IDENTITY_FIELDS) {
      expect(patch[field], `field ${field} must not be cloned`).toBeUndefined()
    }
    // Belt and braces: the allowlist itself must not contain identity fields.
    for (const field of IDENTITY_FIELDS) {
      expect(PLAN_STRUCTURE_FIELDS as readonly string[]).not.toContain(field)
    }
  })

  it('copies structural decisions but drops matter-specific ones and free text', () => {
    const patch = extractPlanStructure(sourceSheet())
    const decisions = patch.decisions as Record<string, unknown>
    expect(decisions.document_inclusions).toEqual({ trust: true, will: true, dpoa: true, healthcare: false })
    expect(decisions.dpoa_provisions).toEqual({ all_basic_powers: true })
    expect((decisions.trust_details as Record<string, unknown>).protect_us_trust_status).toBe(true)
    expect((decisions.trust_details as Record<string, unknown>).special_trustee_instructions).toBeUndefined()
    expect(decisions.deed).toBeUndefined()
    expect(decisions.funding_plan).toBeUndefined()
    expect(decisions.excluded_person).toBeUndefined()
  })
})

describe('applyPlanStructure', () => {
  it('merges decisions so the target keeps its own matter-specific decisions', () => {
    const target = {
      decisions: {
        deed: { property_address: '2 Target Ave' },
        document_inclusions: { trust: false, will: true, dpoa: false, healthcare: false },
      },
    } as unknown as DesignSheet
    const patch = extractPlanStructure(sourceSheet())
    const merged = applyPlanStructure(target, patch)
    const decisions = merged.decisions as Record<string, unknown>
    expect(decisions.deed).toEqual({ property_address: '2 Target Ave' })
    expect(decisions.document_inclusions).toEqual({ trust: true, will: true, dpoa: true, healthcare: false })
  })
})
