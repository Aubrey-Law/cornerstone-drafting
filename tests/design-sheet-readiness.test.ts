import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computeDesignSheetReadiness, parseDesignFocusParam } from '@/lib/designSheetReadiness'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import type { DesignSheet, PipelineMatter } from '@/types/database'

function makeMatter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'matter-1',
    matter_name: 'Doe Estate Plan',
    stage: 'design',
    status: 'active',
    flags: null,
    matter_created: '2026-06-01T00:00:00.000Z',
    client_name: 'Jane Doe',
    client_email: 'jane@example.com',
    client_phone: '(555) 555-5555',
    client_dob: '1980-01-01',
    client_address: '1 Main St',
    spouse_name: null,
    spouse_email: null,
    spouse_phone: null,
    spouse_dob: null,
    spouse_address: null,
    plan_type: 'Estate Planning',
    marital_status: 'Single',
    has_minor_children: false,
    taxable_estate: null,
    intake_status: 'submitted',
    design_status: 'in_progress',
    intake_submitted_at: '2026-06-01T00:00:00.000Z',
    drafts_sent_at: null,
    signing_date: null,
    documents_executed_at: null,
    next_appointment: null,
    next_appointment_type: null,
    referral_source: null,
    fee_amount: null,
    opened_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeSheet(overrides: Partial<DesignSheet> = {}): DesignSheet {
  return {
    id: 'sheet-1',
    matter_id: 'matter-1',
    version: 1,
    status: 'draft',
    client_name: 'Jane Doe',
    client_dob: '1980-01-01',
    client_phone: '(555) 555-5555',
    client_email: 'jane@example.com',
    client_citizenship: 'US Citizen',
    client_domicile: 'Massachusetts',
    street: '1 Main St',
    city: 'Boston',
    state: 'MA',
    zip: '02108',
    county: 'Suffolk',
    marital_status: 'Single',
    spouse_name: null,
    spouse_dob: null,
    spouse_phone: null,
    spouse_email: null,
    spouse_citizenship: null,
    marriage_date: null,
    children: [],
    trustee_primary: null,
    trustee_co: null,
    trustee_alt1: null,
    trustee_alt1_co: null,
    trustee_alt2: null,
    executor_primary: null,
    executor_co: null,
    executor_alt1: null,
    executor_alt1_co: null,
    executor_same_as_trustee: false,
    spouse_executor_same_as_trustee: false,
    poa_primary: null,
    poa_co: null,
    poa_alt1: null,
    poa_same_as_trustee: false,
    spouse_poa_same_as_trustee: false,
    hcp_primary: null,
    hcp_co: null,
    hcp_alt1: null,
    hcp_alt1_co: null,
    guardian_primary: null,
    guardian_co: null,
    guardian_alt1: null,
    guardian_alt1_co: null,
    plan_type: 'pour_over',
    is_joint: false,
    trust_name: 'The Jane Doe Revocable Trust',
    spouse_trust_name: null,
    restatement: false,
    trust_protector: false,
    distribution_method: 'staggered',
    distribution_age: null,
    include_child_gender_markers: 'no',
    include_afterborn_children: 'yes',
    include_expectant_children: 'yes',
    omissions_intentional: 'no',
    include_general_disinheritance: 'yes',
    disinherited_children: [],
    disinherit_issue: 'no',
    additional_disinheritance_language: null,
    include_additional_beneficiaries: 'no',
    additional_beneficiaries: [],
    stagger_age_1: null,
    stagger_pct_1: null,
    stagger_age_2: null,
    stagger_pct_2: null,
    stagger_age_3: null,
    tangible_property_distribution: 'memorandum',
    tangible_property_named_individual: null,
    include_common_disaster: 'yes',
    include_guardians_allowance: 'yes',
    beneficiary_as_cotrustee: 'no',
    beneficiary_as_sole_trustee: 'no',
    remote_beneficiary: 'heirs_at_law',
    provision_lifestyle_disability: 'no',
    provision_substance_abuse: 'no',
    provision_married_beneficiary: 'no',
    client_aka: null,
    spouse_aka: null,
    client_pronouns: null,
    spouse_pronouns: null,
    former_spouse_name: null,
    deceased_spouse_name: null,
    signing_date: null,
    signing_month: null,
    signing_year: null,
    signing_county: null,
    notary_commission_expiration: null,
    dpoa_coagent_manner: 'independently',
    dpoa_include_self_dealing: true,
    dpoa_self_dealing_reviewer: 'Alex Reviewer',
    dpoa_self_dealing_reviewer_alt: null,
    dpoa_include_section_l: 'no',
    hcp_anatomical_gift: 'none',
    hcp_anatomical_specified: null,
    hipaa_psychotherapy_notes: 'do_not_authorize',
    specific_bequests: [],
    pet_care_option: 'omit',
    pet_care_details: {},
    pr_structure: 'single',
    bond: 'no_bond',
    supervision: 'unsupervised',
    simultaneous_death: 'omit',
    utma_age: 21,
    no_contest_clause: 'omit',
    include_disclaimer_article: true,
    include_self_proving_affidavit: true,
    excluded_guardian_flag: false,
    excluded_guardian_name: null,
    trust_date: '2026-06-01',
    pour_over_alternate_disposition: 'spouse_then_descendants',
    pour_over_alternate_named: null,
    outright_residuary: null,
    outright_residuary_named: null,
    outright_residuary_alternate: null,
    trustee_structure: null,
    cotrustee_decision_standard: null,
    beneficiary_structure: null,
    single_beneficiary_name: null,
    single_beneficiary_remainder: null,
    age_distribution_schedule: null,
    trust_protector_name: null,
    disinheritances: null,
    fiduciary_slot_states: null,
    decisions: {
      document_inclusions: {
        trust: true,
        will: true,
        dpoa: true,
        healthcare: true,
        deed: false,
        spouse_docs: false,
      },
      dpoa_provisions: {
        all_basic_powers: true,
      },
      healthcare_provisions: {
        client_advance_directive: 'prolong_life',
      },
    },
    trustee_slots: [{ id: 'trustee-1', contact_id: 'contact-trustee', is_co: false, order: 0 }],
    executor_slots: [{ id: 'executor-1', contact_id: 'contact-executor', is_co: false, order: 0 }],
    poa_slots: [{ id: 'poa-1', contact_id: 'contact-poa', is_co: false, order: 0 }],
    hcp_slots: [{ id: 'hcp-1', contact_id: 'contact-hcp', is_co: false, order: 0 }],
    guardian_slots: [{ id: 'guardian-1', contact_id: null, is_co: false, order: 0 }],
    temporary_guardian_slots: [{ id: 'temp-guardian-1', contact_id: null, is_co: false, order: 0 }],
    spouse_trustee_slots: [{ id: 'spouse-trustee-1', contact_id: null, is_co: false, order: 0 }],
    spouse_executor_slots: [{ id: 'spouse-executor-1', contact_id: null, is_co: false, order: 0 }],
    spouse_poa_slots: [{ id: 'spouse-poa-1', contact_id: null, is_co: false, order: 0 }],
    spouse_hcp_slots: [{ id: 'spouse-hcp-1', contact_id: null, is_co: false, order: 0 }],
    overrides: {},
    goals_notes: 'Avoid probate.',
    concerns: 'Keep drafting simple.',
    assets: [],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('computeDesignSheetReadiness', () => {
  it('surfaces missing client decisions and fields as advisory blockers', () => {
    const readiness = computeDesignSheetReadiness({
      sheet: makeSheet({
        client_email: null,
        trust_name: null,
        dpoa_coagent_manner: null,
        decisions: {
          dpoa_provisions: {
            agent_compensation: null,
            coagent_serving: null,
            all_basic_powers: false,
            basic_powers: {},
          },
          healthcare_provisions: {
            client_anatomical_gift: null,
            client_advance_directive: null,
          },
        },
        hcp_anatomical_gift: null,
      }),
      matter: makeMatter(),
      isLP: false,
      lpData: null,
    })

    expect(readiness.complete).toBe(false)
    const labels = readiness.blockers.map(item => item.label)
    expect(labels).toContain('email')
    expect(labels).toContain('trust name')
    // Client decisions are advisory (category 'client-decision'), still reported so the UI can hint.
    expect(readiness.blockers.some(item => item.category === 'client-decision')).toBe(true)
    // Every blocker carries a jump target so the design sheet can scroll to the field.
    expect(readiness.blockers.every(item => item.targetId.length > 0)).toBe(true)
  })

  it('reports a guardian blocker when minor children lack a guardian nomination', () => {
    const readiness = computeDesignSheetReadiness({
      sheet: makeSheet({
        children: [{ name: 'Alex Doe', dob: '2015-01-01', relationship: 'biological', is_minor: true }],
        guardian_slots: [{ id: 'guardian-1', contact_id: null, is_co: false, order: 0 }],
      }),
      matter: makeMatter({ has_minor_children: true }),
      isLP: false,
      lpData: null,
    })

    expect(readiness.complete).toBe(false)
    expect(readiness.blockers.map(item => item.label)).toContain('guardian')
  })

  it('reports complete with no blockers when included document requirements are met', () => {
    const readiness = computeDesignSheetReadiness({
      sheet: makeSheet(),
      matter: makeMatter(),
      isLP: false,
      lpData: null,
    })

    expect(readiness.complete).toBe(true)
    expect(readiness.blockers).toHaveLength(0)
    expect(readiness.completedCount).toBe(readiness.total)
  })

  it('does not gate LP drafting on design-sheet approval (now a separate client design review)', () => {
    const lpData = {
      li_design_sheet_data: {
        residuary_spouse_survives: 'To my spouse.',
        residuary_no_spouse: 'To my descendants.',
      },
    }
    const readiness = computeDesignSheetReadiness({
      sheet: makeSheet(),
      matter: makeMatter(),
      isLP: true,
      lpData,
    })

    // Approval moved to the client-facing design review; lite never blocks on readiness.
    expect(readiness.blockers).toEqual([])
    expect(readiness.complete).toBe(true)
  })
})

describe('design sheet readiness UI wiring', () => {
  it('surfaces readiness blockers as advisory hints without gating generation', () => {
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx'),
      'utf8',
    )
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )
    const sharedControls = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/shared.tsx'),
      'utf8',
    )
    const personal = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx'),
      'utf8',
    )
    const dpoaProvisions = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/DpoaProvisionsSection.tsx'),
      'utf8',
    )
    const healthcare = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/HealthCareDesignSection.tsx'),
      'utf8',
    )

    expect(workspace).toContain('computeDesignSheetReadiness')
    expect(shell).toContain('readinessComplete')
    expect(shell).toContain('blockerDetails')
    // Blockers hint, never gate: generation must not be disabled by readiness.
    expect(shell).not.toContain('generateDisabled={!readinessComplete}')
    expect(sharedControls).toContain('designFieldTargetId')
    expect(personal).toContain('fieldId="client_email"')
    expect(personal).toContain('fieldId="marital_status"')
    expect(dpoaProvisions).toContain('Compensation for Agents')
    expect(dpoaProvisions).toContain('Trust Powers')
    expect(healthcare).toContain('HIPAA Authorization')
    expect(healthcare).toContain('Advance Health Directive')
  })

  it('preserves blocker focus in standalone navigation and handles each changing focus token', () => {
    const shell = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetShell.tsx'),
      'utf8',
    )
    const express = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx'),
      'utf8',
    )

    expect(shell).toContain("params.set('focus', `${focus.sectionId}:${focus.targetField}`)")
    expect(shell).toContain('handledFocusToken.current === focusToken')
    expect(express).toContain('handledFocusToken.current === focusToken')
    expect(shell).not.toContain('const initialFocusHandled = useRef(false)')
    expect(express).not.toContain('const initialFocusHandled = useRef(false)')
  })
})

describe('parseDesignFocusParam', () => {
  it('parses section and field from drafting Fix links', () => {
    expect(parseDesignFocusParam('personal:county')).toEqual({
      sectionId: DESIGN_SECTION_IDS.clientInformation,
      targetField: 'county',
    })
  })

  it('parses section-only focus when target field is blank', () => {
    expect(parseDesignFocusParam('trust:')).toEqual({
      sectionId: DESIGN_SECTION_IDS.trustDetails,
      targetField: null,
    })
  })

  it('returns null for empty or missing values', () => {
    expect(parseDesignFocusParam(null)).toBeNull()
    expect(parseDesignFocusParam('')).toBeNull()
    expect(parseDesignFocusParam('   ')).toBeNull()
  })
})
