import { DraftContext } from './clauses'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import { designSheetString, isDesignSheetMarried } from '@/lib/draftPayload/designSheetFields'
import { draftPayloadFamilyProvisions } from '@/lib/draftPayload/familyProvisions'
import { getTrustDetails } from '@/lib/designSheetTrustDetails'
import type { DesignSheet } from '@/types/database'
import type { FiduciarySlotRow } from '@/lib/draftPayload/types'

type DesignSheetChildRow = {
  name?: string
  dob?: string | null
  is_minor?: boolean
  first_name?: string
  middle_name?: string
  last_name?: string
}

type DesignSheetCoFields = {
  poa_co?: string | null
  executor_co?: string | null
  guardian_co?: string | null
}

function designSheetChildren(designSheet: Record<string, unknown>): DesignSheetChildRow[] {
  return Array.isArray(designSheet.children) ? designSheet.children as DesignSheetChildRow[] : []
}

function isFiduciarySlotArray(value: unknown): value is FiduciarySlotRow[] {
  return Array.isArray(value) && value.every(slot => {
    if (typeof slot !== 'object' || slot === null || Array.isArray(slot)) return false
    const row = slot as Record<string, unknown>
    return typeof row.id === 'string' &&
      (typeof row.contact_id === 'string' || row.contact_id === null) &&
      typeof row.is_co === 'boolean' &&
      typeof row.order === 'number'
  })
}

function getDesignSlots(designSheet: Record<string, unknown>, key: string): FiduciarySlotRow[] {
  const direct = designSheet[key]
  if (isFiduciarySlotArray(direct)) return direct
  const decisions = (typeof designSheet.decisions === 'object' && designSheet.decisions
    ? designSheet.decisions
    : null) as Record<string, unknown> | null
  const fromDecisions = decisions?.[key]
  return isFiduciarySlotArray(fromDecisions) ? fromDecisions : []
}

function hasNamedLegacyCo(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasFilledCoSlot(slots: FiduciarySlotRow[], order = 0): boolean {
  return slots.some(slot => slot.order === order && slot.is_co && slot.contact_id != null)
}

function hasCoAgent(designSheet: DesignSheetCoFields, slots: FiduciarySlotRow[], legacyKey: keyof DesignSheetCoFields): boolean {
  return hasNamedLegacyCo(designSheet[legacyKey]) || hasFilledCoSlot(slots)
}

/**
 * How residuary shares pass to descendants, for the per stirpes / per capita clause
 * gates in ./clauses.
 *
 * The live control is `decisions.trust_details.representation_type`. Deliberately NOT
 * the `distribution_method` column: despite the name that holds the residual
 * beneficiary method (outright / staggered / trust-for-life / custom), an unrelated
 * decision. `decisions.distribution_method` is a legacy key no current UI writes —
 * reading it alone pinned every matter to the `per_stirpes` default and made the
 * per capita clause unreachable — so it now only serves older matters that carry one.
 */
function descendantRepresentation(
  designSheet: Record<string, unknown>,
  decisions: Record<string, unknown>,
): 'per_stirpes' | 'per_capita' {
  const representation = getTrustDetails(
    designSheet as unknown as Pick<DesignSheet, 'decisions'>,
  ).representation_type

  if (representation === 'per_capita_each_generation') return 'per_capita'
  // 'by_representation' has no clause of its own; per stirpes is the closest of the
  // two and keeps the long-standing output for matters already using it.
  if (representation === 'per_stirpes' || representation === 'by_representation') return 'per_stirpes'

  return decisions.distribution_method === 'per_capita' ? 'per_capita' : 'per_stirpes'
}

/**
 * Builds a DraftContext from the design sheet only.
 * Used by getClausesForDocument() to select the right clauses.
 */
export function buildDraftContext(designSheet: Record<string, unknown>): DraftContext {
  const decisions = (typeof designSheet.decisions === 'object' && designSheet.decisions
    ? designSheet.decisions
    : {}) as Record<string, unknown>

  const children = designSheetChildren(designSheet)
  const hasChildren = children.length > 0
  const hasMinorChildren = children.some(child => child.is_minor === true)
  const isMarried = isDesignSheetMarried(designSheet)

  const hcpAlt1 = designSheetString(designSheet, 'hcp_alt1') ?? ''
  const hcpAlt2 = ''
  const hcpAlt3 = ''

  const guardianAlt = designSheetString(designSheet, 'guardian_alt1') ?? ''
  const hasAltGuardian = Boolean(guardianAlt)

  const successorTrustee =
    designSheetString(designSheet, 'trustee_alt1') ||
    designSheetString(designSheet, 'executor_primary') ||
    ''

  const normalizedPlanType = normalizeDesignPlanType(designSheet.plan_type ?? decisions.plan_type)
  const spouseName = designSheetString(designSheet, 'spouse_name')
  const coFields = designSheet as DesignSheetCoFields
  const poaSlots = getDesignSlots(designSheet, 'poa_slots')
  const executorSlots = getDesignSlots(designSheet, 'executor_slots')
  const guardianSlots = getDesignSlots(designSheet, 'guardian_slots')
  const familyProvisions = draftPayloadFamilyProvisions(designSheet)
  const excludedPerson = familyProvisions.disinherited.length > 0
    ? familyProvisions.disinherited.map(person => person.full_name).join(', ')
    : decisions.excluded_person
      ? String(decisions.excluded_person)
      : undefined

  return {
    is_married: isMarried,
    has_children: hasChildren,
    has_minor_children: hasMinorChildren,

    client_aka: designSheetString(designSheet, 'client_aka') || undefined,
    spouse_aka: designSheetString(designSheet, 'spouse_aka') || undefined,

    excluded_person: excludedPerson,
    excluded_persons: familyProvisions.disinherited.map(person => person.full_name),
    disinherit_issue: familyProvisions.disinherit_issue,
    additional_disinheritance_language: familyProvisions.additional_disinheritance_language ?? undefined,
    include_child_gender_markers: familyProvisions.include_child_gender_markers,
    include_afterborn_children: familyProvisions.include_afterborn_children,
    include_expectant_children: familyProvisions.include_expectant_children,
    omissions_intentional: familyProvisions.omissions_intentional,
    include_general_disinheritance: familyProvisions.include_general_disinheritance,
    excluded_guardian: designSheet.excluded_guardian_flag && designSheet.excluded_guardian_name
      ? String(designSheet.excluded_guardian_name)
      : decisions.excluded_guardian
        ? String(decisions.excluded_guardian)
        : undefined,
    excluded_guardian_2: undefined,

    provisions: (decisions.provisions as string[]) ?? [],
    descendant_representation: descendantRepresentation(designSheet, decisions),
    staggered_ages: decisions.staggered_ages ? String(decisions.staggered_ages) : undefined,

    plan_type: normalizedPlanType ?? String(designSheet.plan_type ?? decisions.plan_type ?? 'pour_over'),

    has_alt1_hcp: !!hcpAlt1,
    has_alt2_hcp: !!hcpAlt2,
    has_alt3_hcp: !!hcpAlt3,

    has_co_trustee: isMarried && Boolean(spouseName),
    has_co_poa: hasCoAgent(coFields, poaSlots, 'poa_co'),
    has_co_pr: hasCoAgent(coFields, executorSlots, 'executor_co'),
    has_co_guardian: hasCoAgent(coFields, guardianSlots, 'guardian_co'),
    has_alt_guardian: hasAltGuardian,
    has_successor_trustee: !!successorTrustee,

    bond: (designSheet.bond as 'no_bond' | 'required') ?? 'no_bond',
    no_contest_clause: (designSheet.no_contest_clause as 'omit' | 'include') ?? 'omit',
    simultaneous_death: designSheet.simultaneous_death as DraftContext['simultaneous_death'] ?? null,
    utma_age: (designSheet.utma_age === 18 ? 18 : 21),
    tangible_property_distribution: designSheet.tangible_property_distribution as DraftContext['tangible_property_distribution'] ?? null,
    tangible_property_named_individual: designSheet.tangible_property_named_individual as string | null ?? null,
    specific_bequests: Array.isArray(designSheet.specific_bequests) ? designSheet.specific_bequests : [],
    pr_structure: designSheet.pr_structure as DraftContext['pr_structure'] ?? null,

    coagent_manner: (designSheet.dpoa_coagent_manner as 'independently' | 'jointly' | 'majority') ?? 'independently',
    anatomical_gift: designSheet.hcp_anatomical_gift as DraftContext['anatomical_gift'] ?? null,
    anatomical_specified: designSheet.hcp_anatomical_specified as string | null ?? null,
  }
}
