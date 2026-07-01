import { getDocumentInclusions, type DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
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
}

export interface DesignSectionSummary {
  status: DesignReadinessStatus
  detail: string | null
  missing?: string[]
  blockers?: DesignReadinessBlocker[]
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
  completedCount: number
  total: number
  documentInclusions: DesignDocumentInclusions
  sectionSummaries: Record<string, DesignSectionSummary>
}

export const DESIGN_SECTION_LABELS: Record<string, string> = {
  'intake-review': 'Intake Review',
  'goals-notes': 'Goals & Notes',
  'plan-design': 'Plan Design',
  trust: 'Trust',
  will: 'Will',
  dpoa: 'Durable Power of Attorney',
  healthcare: 'Health Care Documents',
  deed: 'Deed',
  personal: 'Personal',
  family: 'Family',
  assets: 'Assets',
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
  const sectionId = (colon === -1 ? raw : raw.slice(0, colon)).trim()
  if (!sectionId) return null
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

function isMarried(sheet: DesignSheet) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}

function blocker(
  sectionId: string,
  label: string,
  targetField: string | null,
  category: DesignReadinessBlockerCategory = 'required',
): DesignReadinessBlocker {
  return {
    id: `${sectionId}:${targetField ?? label}`,
    sectionId,
    sectionLabel: DESIGN_SECTION_LABELS[sectionId] ?? sectionId,
    label,
    targetField,
    targetId: targetField ? designFieldTargetId(targetField) : sectionTargetId(sectionId),
    category,
  }
}

function summaryFromBlockers(
  blockers: DesignReadinessBlocker[],
  completeDetail: string,
  overrideCount = 0,
): DesignSectionSummary {
  if (blockers.length > 0) {
    return {
      status: 'attention',
      detail: `${blockers.length} missing`,
      missing: blockers.map(item => item.label),
      blockers,
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
  const hasMinorChildren = sheetHasMinorChildren(sheet.children)
  const spouseTrusteePrimary = primaryContactId(sheet.spouse_trustee_slots)
  const spouseExecutorPrimary = primaryContactId(sheet.spouse_executor_slots)
  const spousePoaPrimary = primaryContactId(sheet.spouse_poa_slots)
  const spouseHcpPrimary = primaryContactId(sheet.spouse_hcp_slots)

  const planBlockers = [
    !normalizedPlanType && blocker('plan-design', 'plan type', 'plan_type'),
    Object.entries(documentInclusions).filter(([key, value]) => key !== 'spouse_docs' && value).length === 0 &&
      blocker('plan-design', 'at least one document', null),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const personalBlockers = [
    !hasText(sheet.client_name) && blocker('personal', 'client name', 'client_name'),
    !hasText(sheet.client_dob) && blocker('personal', 'date of birth', 'client_dob'),
    !hasText(sheet.client_email) && blocker('personal', 'email', 'client_email'),
    !hasText(sheet.marital_status) && blocker('personal', 'marital status', 'marital_status'),
    !hasText(sheet.state) && blocker('personal', 'state', 'state'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const familyBlockers = [
    married && !hasText(sheet.spouse_name) && blocker('family', 'spouse name', 'spouse_name'),
    (hasMinorChildren || matter.has_minor_children) && (sheet.children?.length ?? 0) === 0 &&
      blocker('family', 'children', 'children'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const trustBlockers = [
    documentInclusions.trust && !trusteePrimary && blocker('trust', 'trustee', 'trustee_slots'),
    documentInclusions.trust && spouseFiduciariesNeeded && sheet.is_joint === false && !spouseTrusteePrimary &&
      blocker('trust', 'spouse trustee', 'spouse_trustee_slots'),
    documentInclusions.trust && !hasText(sheet.trust_name) && blocker('trust', 'trust name', 'trust_name'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const willBlockers = [
    documentInclusions.will && !executorPrimary && blocker('will', 'personal representative', 'executor_slots'),
    documentInclusions.will && spouseFiduciariesNeeded && !spouseExecutorPrimary &&
      blocker('will', 'spouse personal representative', 'spouse_executor_slots'),
    documentInclusions.will && hasMinorChildren && !guardianPrimary && blocker('will', 'guardian', 'guardian_slots'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const dpoaBlockers = [
    documentInclusions.dpoa && !poaPrimary && blocker('dpoa', 'power of attorney agent', 'poa_slots'),
    documentInclusions.dpoa && spouseFiduciariesNeeded && !spousePoaPrimary &&
      blocker('dpoa', 'spouse power of attorney agent', 'spouse_poa_slots'),
    documentInclusions.dpoa && !hasText(sheet.dpoa_self_dealing_reviewer) &&
      blocker('dpoa', 'self-dealing reviewer', 'dpoa_self_dealing_reviewer', 'client-decision'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const healthcareBlockers = [
    documentInclusions.healthcare && !hcpPrimary && blocker('healthcare', 'health care proxy', 'hcp_slots'),
    documentInclusions.healthcare && spouseFiduciariesNeeded && !spouseHcpPrimary &&
      blocker('healthcare', 'spouse health care proxy', 'spouse_hcp_slots'),
    documentInclusions.healthcare && !hasText(sheet.hcp_anatomical_gift) &&
      blocker('healthcare', 'anatomical gift election', 'hcp_anatomical_gift', 'client-decision'),
    documentInclusions.healthcare && sheet.hcp_anatomical_gift === 'specified' && !hasText(sheet.hcp_anatomical_specified) &&
      blocker('healthcare', 'specified anatomical gift details', 'hcp_anatomical_specified', 'client-decision'),
    documentInclusions.healthcare && !hasText(sheet.hipaa_psychotherapy_notes) &&
      blocker('healthcare', 'psychotherapy notes election', 'hipaa_psychotherapy_notes', 'client-decision'),
  ].filter(Boolean) as DesignReadinessBlocker[]

  const lpSpecific = lpData?.li_design_sheet_data ?? {}
  // Residuary now lives inside the Will section, so its blockers point at 'will'.
  const residuaryBlockers = isLP ? [
    !hasText(lpSpecific.residuary_spouse_survives) && blocker('will', 'if spouse survives', 'residuary_spouse_survives'),
    !hasText(lpSpecific.residuary_no_spouse) && blocker('will', 'if no spouse survives', 'residuary_no_spouse'),
  ].filter(Boolean) as DesignReadinessBlocker[] : []

  const assetList = Array.isArray(sheet.assets) ? sheet.assets : []
  const assetsFilled = assetList.some(asset => hasText(asset.description) || asset.estimated_value != null)
  const sectionSummaries: Record<string, DesignSectionSummary> = {
    'goals-notes': [sheet.goals_notes, sheet.concerns].some(hasText)
      ? summaryFromBlockers([], 'ready', countOverrides(sheet, ['goals_notes', 'concerns']))
      : { status: 'none', detail: 'add notes' },
    'plan-design': summaryFromBlockers(planBlockers, 'ready', countOverrides(sheet, ['plan_type'])),
    personal: summaryFromBlockers(personalBlockers, 'complete', countOverrides(sheet, [
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
    ])),
    family: summaryFromBlockers(familyBlockers, 'complete', countOverrides(sheet, [
      'spouse_name',
      'spouse_dob',
      'spouse_phone',
      'spouse_email',
      'spouse_citizenship',
      'marriage_date',
      'children',
    ])),
    trust: !documentInclusions.trust
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(trustBlockers, 'ready', countOverrides(sheet, [
        'trust_name',
        'spouse_trust_name',
        'restatement',
        'trust_protector',
      ])),
    will: !documentInclusions.will
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers([...willBlockers, ...residuaryBlockers], 'ready'),
    dpoa: !documentInclusions.dpoa
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(dpoaBlockers, 'ready'),
    healthcare: !documentInclusions.healthcare
      ? { status: 'none', detail: 'not included' }
      : summaryFromBlockers(healthcareBlockers, 'ready'),
    deed: !documentInclusions.deed
      ? { status: 'none', detail: 'not included' }
      : { status: 'complete', detail: 'tracked' },
    assets: optionalSummary(assetsFilled, `${assetList.length} asset${assetList.length === 1 ? '' : 's'}`),
    'office-use': { status: 'complete', detail: 'reference' },
  }

  const requiredIds = [
    'plan-design',
    'personal',
    'family',
    ...(documentInclusions.trust ? ['trust'] : []),
    ...(documentInclusions.will ? ['will'] : []),
    ...(documentInclusions.dpoa ? ['dpoa'] : []),
    ...(documentInclusions.healthcare ? ['healthcare'] : []),
    ...(documentInclusions.deed ? ['deed'] : []),
  ]

  const blockers = requiredIds.flatMap(id => sectionSummaries[id]?.blockers ?? [])
  const completedCount = requiredIds.filter(key => {
    const status = sectionSummaries[key]?.status
    return status === 'complete' || status === 'override'
  }).length

  return {
    complete: blockers.length === 0,
    blockers,
    completedCount,
    total: requiredIds.length,
    documentInclusions,
    sectionSummaries,
  }
}
