import { DraftContext } from './clauses'
import { normalizeDesignPlanType } from '@/lib/designPlanType'

/**
 * Builds a DraftContext from intake + designSheet data.
 * Used by getClausesForDocument() to select the right clauses.
 */
export function buildDraftContext(
  intake: Record<string, unknown>,
  designSheet: Record<string, unknown>,
): DraftContext {
  const decisions = (typeof designSheet.decisions === 'object' && designSheet.decisions
    ? designSheet.decisions
    : {}) as Record<string, unknown>

  // Fiduciaries from intake — legacy object map (the array form was never used).
  const fids = (typeof intake.fiduciaries === 'object' && intake.fiduciaries
    ? intake.fiduciaries
    : {}) as Record<string, string>

  // Legacy helper: the old `fidArray` branch read intake.fiduciary_entries as a
  // flat array, but that column has always been an object — the branch was
  // unreachable. Drafting now reads fiduciaries from contact_roles via the
  // design-sheet projection. Keeping the empty stub so call sites compile
  // unchanged; they fall through to their existing `||` chains.
  function getFid(_role: string, _subject: 'client' | 'spouse', _primary: boolean): string {
    return ''
  }

  // HCP alts — from array format or legacy fids object
  const hcpAlt1 = getFid('hcp', 'client', false) || fids.hcp_alt1 || ''
  const hcpAlt2 = fids.hcp_alt2 || ''
  const hcpAlt3 = fids.hcp_alt3 || ''

  // Guardian alt
  const guardOrder = Array.isArray(fids.guardian_order) ? fids.guardian_order as string[] : []
  const hasAltGuardian = !!guardOrder[1] || !!fids.temporary_guardian ||
    !!getFid('guardian', 'client', false)

  // Successor trustee / PR
  const successorTrustee = getFid('personal_rep', 'client', true) ||
    fids.trustee_pr || fids.successor_trustee || fids.executor || ''

  const normalizedPlanType = normalizeDesignPlanType(designSheet.plan_type ?? decisions.plan_type)

  return {
    is_married:         intake.marital_status === 'married',
    has_children:       Boolean(intake.has_children),
    has_minor_children: Boolean(intake.has_minor_children),

    client_aka:   intake.prior_names       ? String(intake.prior_names)       : undefined,
    spouse_aka:   intake.spouse_prior_names ? String(intake.spouse_prior_names) : undefined,

    excluded_person:    decisions.excluded_person    ? String(decisions.excluded_person)    : undefined,
    excluded_guardian:  designSheet.excluded_guardian_flag && designSheet.excluded_guardian_name
      ? String(designSheet.excluded_guardian_name)
      : decisions.excluded_guardian  ? String(decisions.excluded_guardian)
      : intake.excluded_guardian     ? String(intake.excluded_guardian)
      : undefined,
    excluded_guardian_2: intake.excluded_guardian_2  ? String(intake.excluded_guardian_2)  : undefined,

    provisions:          (decisions.provisions as string[]) ?? [],
    distribution_method: ((decisions.distribution_method as string) ?? 'per_stirpes') as 'per_stirpes' | 'per_capita',
    staggered_ages:      decisions.staggered_ages ? String(decisions.staggered_ages) : undefined,

    plan_type: normalizedPlanType ?? String(designSheet.plan_type ?? decisions.plan_type ?? 'pour_over'),

    has_alt1_hcp: !!hcpAlt1,
    has_alt2_hcp: !!hcpAlt2,
    has_alt3_hcp: !!hcpAlt3,

    has_co_trustee:      intake.marital_status === 'married' && !!(intake.spouse_first_name),
    has_co_poa:          false,
    has_co_pr:           false,
    has_co_guardian:     false,
    has_alt_guardian:    hasAltGuardian,
    has_successor_trustee: !!successorTrustee,

    bond:                              (designSheet.bond as 'no_bond' | 'required') ?? 'no_bond',
    no_contest_clause:                 (designSheet.no_contest_clause as 'omit' | 'include') ?? 'omit',
    simultaneous_death:                designSheet.simultaneous_death as DraftContext['simultaneous_death'] ?? null,
    utma_age:                          (designSheet.utma_age === 18 ? 18 : 21),
    tangible_property_distribution:    designSheet.tangible_property_distribution as DraftContext['tangible_property_distribution'] ?? null,
    tangible_property_named_individual: designSheet.tangible_property_named_individual as string | null ?? null,
    specific_bequests:                 Array.isArray(designSheet.specific_bequests) ? designSheet.specific_bequests : [],
    pr_structure:                      designSheet.pr_structure as DraftContext['pr_structure'] ?? null,

    coagent_manner:        (designSheet.dpoa_coagent_manner as 'independently' | 'jointly' | 'majority') ?? 'independently',
    anatomical_gift:       designSheet.hcp_anatomical_gift as DraftContext['anatomical_gift'] ?? null,
    anatomical_specified:  designSheet.hcp_anatomical_specified as string | null ?? null,
  }
}
