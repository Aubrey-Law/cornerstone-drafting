import { getDocumentInclusions, type DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { getDesignSheetDpoaProvisions } from '@/lib/designSheetDpoaProvisions'
import { getDesignSheetHealthcareProvisions } from '@/lib/designSheetHealthcareProvisions'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import { resolveResidualBeneficiaryMethod } from '@/lib/designSheetTrustDetails'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import { DESIGN_SECTION_IDS, normalizeDesignSectionId } from '@/lib/designSheet/sectionIds'
import type { DesignSheet, PipelineMatter } from '@/types/database'

export type DesignReadinessStatus = 'none' | 'complete' | 'attention' | 'override'
export type DesignReadinessBlockerCategory = 'required' | 'client-decision' | 'approval'

export interface DesignReadinessBlocker {
  id: string
  sectionId: string
  sectionLabel: string
  label: string
  targetField: string | null
  targetId: string
  category: DesignReadinessBlockerCategory
  blocking: boolean
}

export interface DesignSectionSummary {
  status: DesignReadinessStatus
  detail: string | null
  missing?: string[]
  blockers?: DesignReadinessBlocker[]
  blockingCount?: number
  optionalCount?: number
}

interface LpDataShape {
  li_design_sheet_data: Record<string, unknown>
}

interface ComputeDesignSheetReadinessArgs {
  sheet: DesignSheet
  matter: Pick<PipelineMatter, 'has_minor_children'>
  isLP: boolean
  lpData: LpDataShape | null
}

export interface DesignSheetReadiness {
  complete: boolean
  blockers: DesignReadinessBlocker[]
  blocking: DesignReadinessBlocker[]
  optional: DesignReadinessBlocker[]
  completedCount: number
  total: number
  documentInclusions: DesignDocumentInclusions
  sectionSummaries: Record<string, DesignSectionSummary>
}

export const DESIGN_SECTION_LABELS: Record<string, string> = {
  [DESIGN_SECTION_IDS.intakeReview]: 'Intake Review',
  [DESIGN_SECTION_IDS.clientInformation]: 'Client Information',
  [DESIGN_SECTION_IDS.familyInformation]: 'Last Will and Testament',
  [DESIGN_SECTION_IDS.contactsFiduciaries]: 'Contacts & Fiduciaries',
  [DESIGN_SECTION_IDS.fiduciaries]: 'Fiduciary Role Assignment',
  [DESIGN_SECTION_IDS.estatePlanDesign]: 'Estate Plan Design',
  [DESIGN_SECTION_IDS.trustDetails]: 'Trust Details',
  [DESIGN_SECTION_IDS.willDetails]: 'Will Details',
  [DESIGN_SECTION_IDS.financialPoa]: 'Financial Power of Attorney',
  [DESIGN_SECTION_IDS.healthcareDirectives]: 'Health Care & Directives',
  [DESIGN_SECTION_IDS.assetSchedules]: 'Asset Schedules',
  [DESIGN_SECTION_IDS.transfersAssignments]: 'Transfers & Assignments',
  [DESIGN_SECTION_IDS.attorneyNotes]: 'Attorney Notes',
  // Legacy ids (deep links / preflight)
  'goals-notes': 'Attorney Notes',
  'plan-design': 'Estate Plan Design',
  trust: 'Trust Details',
  will: 'Will Details',
  dpoa: 'Financial Power of Attorney',
  healthcare: 'Health Care & Directives',
  deed: 'Transfers & Assignments',
  personal: 'Client Information',
  family: 'Last Will and Testament',
  assets: 'Asset Schedules',
  'office-use': 'Office Use',
  'residuary-estate': 'Residuary Estate',
}

export function designFieldTargetId(field: string) {
  return `design-field-${field}`
}

/** Parses `?focus=<sectionId>:<targetField>` from drafting preflight Fix links. */
export function parseDesignFocusParam(raw: string | null | undefined): { sectionId: string; targetField: string | null } | null {
  if (!raw?.trim()) return null
  const colon = raw.indexOf(':')
  const sectionIdRaw = (colon === -1 ? raw : raw.slice(0, colon)).trim()
  if (!sectionIdRaw) return null
  const sectionId = normalizeDesignSectionId(sectionIdRaw) ?? sectionIdRaw
  const targetField = colon === -1 ? null : (raw.slice(colon + 1).trim() || null)
  return { sectionId, targetField }
}

function sectionTargetId(sectionId: string) {
  return `design-section-${sectionId}`
}

function hasText(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

function countOverrides(sheet: DesignSheet, fields: string[]) {
  const overrides = sheet.overrides ?? {}
  return fields.filter(field => Boolean(overrides[field])).length
}

function primaryContactId(slots: DesignSheet['trustee_slots'] | DesignSheet['executor_slots'] | DesignSheet['poa_slots'] | DesignSheet['hcp_slots'] | DesignSheet['guardian_slots']) {
  return (slots ?? []).find(slot => slot.order === 0 && !slot.is_co)?.contact_id ?? null
}

function alternateContactId(slots: DesignSheet['trustee_slots'] | DesignSheet['executor_slots'] | DesignSheet['poa_slots'] | DesignSheet['hcp_slots'] | DesignSheet['guardian_slots']) {
  return (slots ?? []).find(slot => slot.order > 0 && !slot.is_co)?.contact_id ?? null
}

function isMarried(sheet: DesignSheet) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}

function blocker(
  sectionId: string,
  label: string,
  targetField: string | null,
  category: DesignReadinessBlockerCategory = 'required',
  blocking = true,
): DesignReadinessBlocker {
  const normalizedSectionId = normalizeDesignSectionId(sectionId) ?? sectionId
  return {
    id: `${normalizedSectionId}:${targetField ?? label}`,
    sectionId: normalizedSectionId,
    sectionLabel: DESIGN_SECTION_LABELS[normalizedSectionId] ?? DESIGN_SECTION_LABELS[sectionId] ?? sectionId,
    label,
    targetField,
    targetId: targetField ? designFieldTargetId(targetField) : sectionTargetId(sectionId),
    category,
    blocking,
  }
}

function summaryFromBlockers(
  blockers: DesignReadinessBlocker[],
  completeDetail: string,
  overrideCount = 0,
): DesignSectionSummary {
  if (blockers.length > 0) {
    const blockingCount = blockers.filter(item => item.blocking).length
    const optionalCount = blockers.filter(item => !item.blocking).length
    const detail = [
      blockingCount > 0 ? `${blockingCount} blocking` : null,
      optionalCount > 0 ? `${optionalCount} optional` : null,
    ].filter(Boolean).join(' · ')
    return {
      status: 'attention',
      detail,
      missing: blockers.map(item => item.label),
      blockers,
      blockingCount,
      optionalCount,
    }
  }

  if (overrideCount > 0) {
    return {
      status: 'override',
      detail: `${overrideCount} override${overrideCount === 1 ? '' : 's'}`,
    }
  }

  return { status: 'complete', detail: completeDetail }
}

function optionalSummary(hasValue: boolean, detail: string): DesignSectionSummary {
  return hasValue ? { status: 'complete', detail } : { status: 'none', detail: 'optional' }
}

export function computeDesignSheetReadiness({
  sheet,
  matter,
  isLP,
  lpData,
}: ComputeDesignSheetReadinessArgs): DesignSheetReadiness {
  const documentInclusions = getDocumentInclusions(sheet)
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const married = isMarried(sheet)
  const spouseFiduciariesNeeded = married && documentInclusions.spouse_docs

  const trusteePrimary = primaryContactId(sheet.trustee_slots)
  const executorPrimary = sheet.executor_same_as_trustee ? trusteePrimary : primaryContactId(sheet.executor_slots)
  const poaPrimary = sheet.poa_same_as_trustee ? trusteePrimary : primaryContactId(sheet.poa_slots)
  const hcpPrimary = primaryContactId(sheet.hcp_slots)
  const guardianPrimary = primaryContactId(sheet.guardian_slots)
  const temporaryGuardianPrimary = primaryContactId(sheet.temporary_guardian_slots)
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)
  const spouseTrusteePrimary = primaryContactId(sheet.spouse_trustee_slots)
  const spouseExecutorPrimary = primaryContactId(sheet.spouse_executor_slots)
  const spousePoaPrimary = primaryContactId(sheet.spouse_poa_slots)
  const spouseHcpPrimary = primaryContactId(sheet.spouse_hcp_slots)
  const trusteeAlternate = alternateContactId(sheet.trustee_slots)
  const executorAlternate = alternateContactId(sheet.executor_slots)
  const poaAlternate = alternateContactId(sheet.poa_slots)
  const hcpAlternate = alternateContactId(sheet.hcp_slots)
  const guardianAlternate = alternateContactId(sheet.guardian_slots)
  const spouseTrusteeAlternate = alternateContactId(sheet.spouse_trustee_slots)
  const spouseExecutorAlternate = alternateContactId(sheet.spouse_executor_slots)
  const spousePoaAlternate = alternateContactId(sheet.spouse_poa_slots)
  const spouseHcpAlternate = alternateContactId(sheet.spouse_hcp_slots)
  const estatePlanSetup = sheet.decisions?.estate_plan_setup
  const signingType = estatePlanSetup && typeof estatePlanSetup === 'object' && !Array.isArray(estatePlanSetup)
    ? (estatePlanSetup as Record<string, unknown>).signing_type
    : null
  const dpoaProvisions = getDesignSheetDpoaProvisions(sheet)
  const healthcareProvisions = getDesignSheetHealthcareProvisions(sheet)
  const hasDpoaBasicPowers = dpoaProvisions.all_basic_powers
    || Object.values(dpoaProvisions.basic_powers).some(Boolean)

  const familyBlockers = [
    (hasMinorChildren || matter.has_minor_children) && (sheet.children?.length ?? 0) === 0 &&
      blocker(DESIGN_SECTION_IDS.clientInformation, 'children', 'children'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const planBlockers = [
    !normalizedPlanType && blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'plan type', 'plan_type'),
    documentInclusions.trust && married && sheet.is_joint == null &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'joint or separate trusts', 'is_joint'),
    // Checks the resolved value, not just presence: a legacy sheet carrying an
    // unrecognised string (e.g. 'per stirpes', left over from when this column
    // meant something else) satisfied `hasText` and so was never flagged, while
    // the generator quietly fell back to a staged distribution.
    documentInclusions.trust && resolveResidualBeneficiaryMethod(sheet) == null &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'distribution method', 'residual_beneficiary_method'),
    Object.entries(documentInclusions).filter(([key, value]) => key !== 'spouse_docs' && value).length === 0 &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'at least one document', null),
    (!hasText(signingType) || signingType === 'undecided') &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'signing type', 'estate_plan_setup.signing_type', 'client-decision', false),
    !hasText(sheet.signing_date) &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'signing date', 'signing_date', 'client-decision', false),
    !hasText(sheet.signing_county) &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'signing county', 'signing_county', 'client-decision', false),
    !hasText(sheet.notary_commission_expiration) &&
      blocker(DESIGN_SECTION_IDS.estatePlanDesign, 'notary commission expiration', 'notary_commission_expiration', 'client-decision', false),
    ...familyBlockers,
  ].filter(Boolean) as DesignReadinessBlocker[]

  const clientBlockers = [
    !hasText(sheet.client_name) && blocker(DESIGN_SECTION_IDS.clientInformation, 'client name', 'client_name'),
    !hasText(sheet.client_dob) && blocker(DESIGN_SECTION_IDS.clientInformation, 'date of birth', 'client_dob'),
    !hasText(sheet.client_email) && blocker(DESIGN_SECTION_IDS.clientInformation, 'email', 'client_email'),
    !hasText(sheet.marital_status) && blocker(DESIGN_SECTION_IDS.clientInformation, 'marital status', 'marital_status'),
    !hasText(sheet.state) && blocker(DESIGN_SECTION_IDS.clientInformation, 'state', 'state'),
    married && !hasText(sheet.spouse_name) && blocker(DESIGN_SECTION_IDS.clientInformation, 'spouse name', 'spouse_name'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const clientTrustBlockers = [
    documentInclusions.trust && !trusteePrimary && blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'successor trustee', 'trustee_slots'),
    documentInclusions.trust && trusteePrimary && !trusteeAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'backup trustee', 'trustee_slots', 'required', false),
    documentInclusions.trust && !hasText(sheet.trust_name) && blocker(DESIGN_SECTION_IDS.trustDetails, 'trust name', 'trust_name'),
    documentInclusions.trust && spouseFiduciariesNeeded && sheet.is_joint === false && !spouseTrusteePrimary &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse trustee', 'spouse_trustee_slots'),
    documentInclusions.trust && married && sheet.is_joint === false && !hasText(sheet.spouse_trust_name) &&
      blocker(DESIGN_SECTION_IDS.trustDetails, 'spouse trust name', 'spouse_trust_name'),
    documentInclusions.trust && spouseFiduciariesNeeded && sheet.is_joint === false && spouseTrusteePrimary && !spouseTrusteeAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse backup trustee', 'spouse_trustee_slots', 'required', false),
    documentInclusions.trust && !hasText(sheet.remote_beneficiary) &&
      blocker(DESIGN_SECTION_IDS.trustDetails, 'remote-contingency beneficiaries', 'remote_beneficiary', 'client-decision', false),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const spouseTrustBlockers = [] as DesignReadinessBlocker[]

  const willBlockers = [
    documentInclusions.will && !executorPrimary && blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'personal representative', 'executor_slots'),
    documentInclusions.will && executorPrimary && !executorAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'backup personal representative', 'executor_slots', 'required', false),
    documentInclusions.will && spouseFiduciariesNeeded && !spouseExecutorPrimary &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse personal representative', 'spouse_executor_slots'),
    documentInclusions.will && spouseFiduciariesNeeded && spouseExecutorPrimary && !spouseExecutorAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse backup personal representative', 'spouse_executor_slots', 'required', false),
    documentInclusions.will && hasMinorChildren && !guardianPrimary && blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'guardian', 'guardian_slots'),
    documentInclusions.will && hasMinorChildren && guardianPrimary && !guardianAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'backup guardian', 'guardian_slots', 'required', false),
    // Optional by design: a temporary guardian delegates short-term care and is a
    // refinement on top of the permanent appointment, never a reason to hold drafting.
    documentInclusions.will && hasMinorChildren && !temporaryGuardianPrimary &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'temporary guardian', 'temporary_guardian_slots', 'required', false),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const dpoaBlockers = [
    documentInclusions.dpoa && !poaPrimary && blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'first attorney-in-fact', 'poa_slots'),
    documentInclusions.dpoa && poaPrimary && !poaAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'backup attorney-in-fact', 'poa_slots', 'required', false),
    documentInclusions.dpoa && spouseFiduciariesNeeded && !spousePoaPrimary &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse first attorney-in-fact', 'spouse_poa_slots'),
    documentInclusions.dpoa && spouseFiduciariesNeeded && spousePoaPrimary && !spousePoaAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse backup attorney-in-fact', 'spouse_poa_slots', 'required', false),
    documentInclusions.dpoa && !dpoaProvisions.agent_compensation &&
      blocker(DESIGN_SECTION_IDS.financialPoa, 'agent compensation', 'dpoa_provisions.agent_compensation', 'client-decision'),
    documentInclusions.dpoa && !dpoaProvisions.coagent_serving &&
      blocker(DESIGN_SECTION_IDS.financialPoa, 'co-agent decision-making', 'dpoa_provisions.coagent_serving', 'client-decision'),
    documentInclusions.dpoa && !hasDpoaBasicPowers &&
      blocker(DESIGN_SECTION_IDS.financialPoa, 'basic attorney-in-fact powers', 'dpoa_provisions.basic_powers', 'client-decision'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const healthcareBlockers = [
    documentInclusions.healthcare && !hcpPrimary && blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'first health care agent', 'hcp_slots'),
    documentInclusions.healthcare && hcpPrimary && !hcpAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'backup health care agent', 'hcp_slots', 'required', false),
    documentInclusions.healthcare && spouseFiduciariesNeeded && !spouseHcpPrimary &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse first health care agent', 'spouse_hcp_slots'),
    documentInclusions.healthcare && spouseFiduciariesNeeded && spouseHcpPrimary && !spouseHcpAlternate &&
      blocker(DESIGN_SECTION_IDS.contactsFiduciaries, 'spouse backup health care agent', 'spouse_hcp_slots', 'required', false),
    documentInclusions.healthcare && !healthcareProvisions.client_anatomical_gift &&
      blocker(DESIGN_SECTION_IDS.healthcareDirectives, 'anatomical gift election', 'healthcare_provisions.client_anatomical_gift', 'client-decision'),
    documentInclusions.healthcare && spouseFiduciariesNeeded && !healthcareProvisions.spouse_anatomical_gift &&
      blocker(DESIGN_SECTION_IDS.healthcareDirectives, 'spouse anatomical gift election', 'healthcare_provisions.spouse_anatomical_gift', 'client-decision'),
    documentInclusions.healthcare && !healthcareProvisions.client_advance_directive &&
      blocker(DESIGN_SECTION_IDS.healthcareDirectives, 'advance health directive', 'healthcare_provisions.client_advance_directive', 'client-decision'),
    documentInclusions.healthcare && spouseFiduciariesNeeded && !healthcareProvisions.spouse_advance_directive &&
      blocker(DESIGN_SECTION_IDS.healthcareDirectives, 'spouse advance health directive', 'healthcare_provisions.spouse_advance_directive', 'client-decision'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const fiduciaryBlockers = [
    ...clientTrustBlockers,
    ...willBlockers,
    ...dpoaBlockers,
    ...healthcareBlockers,
  ].filter(item => item.sectionId === DESIGN_SECTION_IDS.contactsFiduciaries)
  const provisionBlockers = (items: DesignReadinessBlocker[]) =>
    items.filter(item => item.sectionId !== DESIGN_SECTION_IDS.contactsFiduciaries)

  const lpSpecific = lpData?.li_design_sheet_data ?? {}
  const residuaryBlockers = isLP ? [
    !hasText(lpSpecific.residuary_spouse_survives) && blocker(DESIGN_SECTION_IDS.willDetails, 'if spouse survives', 'residuary_spouse_survives'),
    !hasText(lpSpecific.residuary_no_spouse) && blocker(DESIGN_SECTION_IDS.willDetails, 'if no spouse survives', 'residuary_no_spouse'),
  ].filter(Boolean) as DesignReadinessBlocker[] : []

  const assetList = Array.isArray(sheet.assets) ? sheet.assets : []
  const assetsFilled = assetList.some(asset => hasText(asset.description) || asset.estimated_value != null)
  const sectionSummaries: Record<string, DesignSectionSummary> = {
    [DESIGN_SECTION_IDS.attorneyNotes]: [sheet.goals_notes, sheet.concerns].some(hasText)
      ? summaryFromBlockers([], 'ready', countOverrides(sheet, ['goals_notes', 'concerns']))
      : { status: 'none', detail: 'add notes' },
    [DESIGN_SECTION_IDS.estatePlanDesign]: summaryFromBlockers(planBlockers, 'ready', countOverrides(sheet, ['plan_type'])),
    [DESIGN_SECTION_IDS.clientInformation]: summaryFromBlockers(clientBlockers, 'complete', countOverrides(sheet, [
      'client_name',
      'client_dob',
      'client_phone',
      'client_email',
      'street',
      'city',
      'state',
      'zip',
      'marital_status',
      'county',
      'client_citizenship',
      'client_domicile',
      'spouse_name',
      'spouse_dob',
      'spouse_phone',
      'spouse_email',
      'spouse_citizenship',
      'marriage_date',
    ])),
    [DESIGN_SECTION_IDS.familyInformation]: summaryFromBlockers([], 'complete'),
    [DESIGN_SECTION_IDS.fiduciaries]: summaryFromBlockers(fiduciaryBlockers, 'ready'),
    [DESIGN_SECTION_IDS.contactsFiduciaries]: summaryFromBlockers([], 'ready'),
    [DESIGN_SECTION_IDS.trustDetails]: !documentInclusions.trust
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(provisionBlockers([...clientTrustBlockers, ...spouseTrustBlockers]), 'ready', countOverrides(sheet, [
        'trust_name',
        'restatement',
        'trust_protector',
        'trustee_structure',
        'cotrustee_decision_standard',
        'spouse_trust_name',
      ])),
    [DESIGN_SECTION_IDS.willDetails]: !documentInclusions.will
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers([...provisionBlockers(willBlockers), ...residuaryBlockers], 'ready'),
    [DESIGN_SECTION_IDS.financialPoa]: !documentInclusions.dpoa
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(provisionBlockers(dpoaBlockers), 'ready'),
    [DESIGN_SECTION_IDS.healthcareDirectives]: !documentInclusions.healthcare
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(provisionBlockers(healthcareBlockers), 'ready'),
    [DESIGN_SECTION_IDS.assetSchedules]: optionalSummary(assetsFilled, `${assetList.length} asset${assetList.length === 1 ? '' : 's'}`),
  }

  const requiredIds = [
    DESIGN_SECTION_IDS.estatePlanDesign,
    DESIGN_SECTION_IDS.clientInformation,
    DESIGN_SECTION_IDS.familyInformation,
    DESIGN_SECTION_IDS.fiduciaries,
    ...(documentInclusions.trust ? [DESIGN_SECTION_IDS.trustDetails] : []),
    ...(documentInclusions.will ? [DESIGN_SECTION_IDS.willDetails] : []),
    ...(documentInclusions.dpoa ? [DESIGN_SECTION_IDS.financialPoa] : []),
    ...(documentInclusions.healthcare ? [DESIGN_SECTION_IDS.healthcareDirectives] : []),
  ]

  const completedCount = requiredIds.filter(key => {
    const status = sectionSummaries[key]?.status
    return status === 'complete' || status === 'override'
  }).length

  const blockers = requiredIds.flatMap(key => sectionSummaries[key]?.blockers ?? [])
  const blocking = blockers.filter(item => item.blocking)
  const optional = blockers.filter(item => !item.blocking)

  return {
    // Cornerstone Lite policy: blockers are advisory. They power inline field
    // hints and the summary-rail pills, but nothing may disable generation.
    complete: blocking.length === 0,
    blockers,
    blocking,
    optional,
    completedCount,
    total: requiredIds.length,
    documentInclusions,
    sectionSummaries,
  }
}
