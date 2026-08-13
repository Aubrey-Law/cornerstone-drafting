import { resolveResidualBeneficiaryMethod } from '@/lib/designSheetTrustDetails'
import type { DesignSheet } from '@/types/database'

/**
 * "Copy plan structure from another matter": estate plans repeat, so a solo
 * attorney should be able to start a new design sheet from the last similar
 * one. Only STRUCTURAL choices are copied — never identity data (names,
 * contacts, fiduciary slots, children, assets, property, free-text notes),
 * which stays seeded from this matter's own intake.
 */

/** Top-level design-sheet columns that describe plan structure, not people. */
export const PLAN_STRUCTURE_FIELDS = [
  'plan_type',
  'is_joint',
  'trust_protector',
  // The residual beneficiary method is absent here on purpose: it lives in
  // decisions.trust_details, which extractPlanStructure copies below.
  'distribution_age',
  'staggered_distributions',
  'stagger_age_1',
  'stagger_pct_1',
  'stagger_age_2',
  'stagger_pct_2',
  'stagger_age_3',
  'include_child_gender_markers',
  'include_afterborn_children',
  'include_expectant_children',
  'omissions_intentional',
  'include_general_disinheritance',
  'disinherit_issue',
  'tangible_property_distribution',
  'include_common_disaster',
  'include_guardians_allowance',
  'beneficiary_as_cotrustee',
  'beneficiary_as_sole_trustee',
  'remote_beneficiary',
  'provision_lifestyle_disability',
  'provision_substance_abuse',
  'provision_married_beneficiary',
  'dpoa_coagent_manner',
  'dpoa_include_self_dealing',
  'dpoa_include_section_l',
  'hipaa_psychotherapy_notes',
  'pr_structure',
  'bond',
  'supervision',
  'simultaneous_death',
  'utma_age',
  'no_contest_clause',
  'include_disclaimer_article',
  'include_self_proving_affidavit',
  'pour_over_alternate_disposition',
  'trustee_structure',
  'cotrustee_decision_standard',
  'beneficiary_structure',
] as const satisfies readonly (keyof DesignSheet)[]

/**
 * Structural keys inside the `decisions` JSON blob. Matter-specific decisions
 * (deed, real_estate_transfer, funding_plan, excluded_person/guardian,
 * fiduciary mappings) are deliberately NOT copied.
 */
const PLAN_STRUCTURE_DECISION_KEYS = [
  // plan_type is a real column (copied via PLAN_STRUCTURE_FIELDS above);
  // persistence strips writable-column names out of `decisions` on every
  // save, so listing it here only copied a key that immediately vanished.
  'document_inclusions',
  'estate_plan_design',
  'trust_planning_type',
  'trust_details',
  'dpoa_provisions',
  'healthcare_provisions',
  'will_pr_powers',
  'staggered_ages',
  'provisions',
] as const

/** Free-text sub-fields inside structural decisions that may reference people. */
const STRIPPED_TRUST_DETAIL_FIELDS = ['special_trustee_instructions'] as const

export function extractPlanStructure(source: DesignSheet): Partial<DesignSheet> {
  const patch: Record<string, unknown> = {}

  for (const field of PLAN_STRUCTURE_FIELDS) {
    const value = source[field]
    if (value !== undefined) patch[field] = value
  }

  const sourceDecisions = source.decisions
  if (sourceDecisions && typeof sourceDecisions === 'object') {
    const decisions: Record<string, unknown> = {}
    for (const key of PLAN_STRUCTURE_DECISION_KEYS) {
      const value = (sourceDecisions as Record<string, unknown>)[key]
      if (value === undefined) continue
      if (key === 'trust_details' && value && typeof value === 'object') {
        const trustDetails = { ...(value as Record<string, unknown>) }
        for (const stripped of STRIPPED_TRUST_DETAIL_FIELDS) delete trustDetails[stripped]
        decisions[key] = trustDetails
      } else {
        decisions[key] = value
      }
    }
    if (Object.keys(decisions).length > 0) patch.decisions = decisions
  }

  // Copied explicitly rather than relying on the trust_details spread: a source
  // sheet with no trust_details block at all still carries the choice across.
  const residualMethod = resolveResidualBeneficiaryMethod(source)
  if (residualMethod) {
    const decisions = (patch.decisions ?? {}) as Record<string, unknown>
    const trustDetails = (decisions.trust_details ?? {}) as Record<string, unknown>
    patch.decisions = {
      ...decisions,
      trust_details: { ...trustDetails, residual_beneficiary_method: residualMethod },
    }
  }

  return patch as Partial<DesignSheet>
}

/**
 * Merge the structural patch into the target sheet. `decisions` merges key by
 * key so the target keeps its own matter-specific decisions (deed, funding
 * plan, exclusions); everything else replaces wholesale.
 */
export function applyPlanStructure(target: DesignSheet, patch: Partial<DesignSheet>): Partial<DesignSheet> {
  const { decisions: patchDecisions, ...rest } = patch
  const result: Record<string, unknown> = { ...rest }
  if (patchDecisions && typeof patchDecisions === 'object') {
    result.decisions = {
      ...(target.decisions && typeof target.decisions === 'object' ? target.decisions : {}),
      ...(patchDecisions as Record<string, unknown>),
    }
  }
  return result as Partial<DesignSheet>
}
