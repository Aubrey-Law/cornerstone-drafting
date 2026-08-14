import { designPlanTypeIncludesRevocableTrust, normalizeDesignPlanType } from '@/lib/designPlanType'
import { getCollegePrepDesign, isCollegePrepDesignSheet } from '@/lib/collegePrepDesign'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import type { DesignSheet } from '@/types/database'

export type DesignDocumentKey = 'trust' | 'will' | 'dpoa' | 'healthcare' | 'deed' | 'young_adult_estate_plan' | 'ferpa_release' | 'education_poa'

export type DesignDocumentInclusions = Record<DesignDocumentKey, boolean> & {
  spouse_docs: boolean
}

export type EstatePlanWillTitle = 'last_will' | 'pour_over_will'
export type EstatePlanSigningType = 'undecided' | 'attorney_supervised' | 'independent_client'

export type EstatePlanAncillaryDocumentKey =
  | 'certificate_of_trust'
  | 'assignment_of_personal_property'
  | 'funding_instructions'
  | 'funding_recommendation'
  | 'homestead_trustee'
  | 'trust_summary'
  | 'estate_plan_summary'
  | 'estate_plan_signing_guide'
  | 'successor_trustee_checklist'
  | 'fiduciary_role_guide'
  | 'flowchart'
  | 'include_asset_spreadsheet'

export interface EstatePlanDesignSetup {
  trust: boolean
  will: boolean
  power_of_attorney: boolean
  health_care_proxy: boolean
  hipaa_authorization: boolean
  living_will: boolean
  will_title: EstatePlanWillTitle
  signing_type: EstatePlanSigningType
  ancillary_documents: Record<EstatePlanAncillaryDocumentKey, boolean>
}

export const DESIGN_DOCUMENT_LABELS: Record<DesignDocumentKey, string> = {
  trust: 'Trust',
  will: 'Will',
  dpoa: 'Durable Power of Attorney',
  healthcare: 'Health Care Documents',
  deed: 'Deed',
  young_adult_estate_plan: 'Young Adult Estate Plan',
  ferpa_release: 'FERPA Release',
  education_poa: 'Education Power of Attorney',
}

export const ESTATE_PLAN_ANCILLARY_LABELS: Record<EstatePlanAncillaryDocumentKey, string> = {
  certificate_of_trust: 'Certificate of Trust',
  assignment_of_personal_property: 'Assignment of Personal Property',
  funding_instructions: 'Funding Instructions',
  funding_recommendation: 'Funding Recommendation',
  homestead_trustee: 'Declaration of Homestead (Trustee)',
  trust_summary: 'Trust Summary',
  estate_plan_summary: 'Estate Plan Summary',
  estate_plan_signing_guide: 'Estate Plan Signing Guide',
  successor_trustee_checklist: 'Successor Trustee Checklist',
  fiduciary_role_guide: 'Fiduciary Role Guide',
  flowchart: 'Flowchart',
  include_asset_spreadsheet: 'Include Asset Spreadsheet',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function defaultDocumentInclusions(sheet: Pick<DesignSheet, 'plan_type' | 'marital_status' | 'matter_type'> & Partial<Pick<DesignSheet, 'children' | 'decisions'>>): DesignDocumentInclusions {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const hasPlanType = normalizedPlanType !== null
  const isMarried = sheet.matter_type === 'couple'
  const hasYoungAdultChild = hasYoungAdultEstatePlanChild(sheet.children)

  // A College Preparation Plan is one student's incapacity set — the durable
  // power of attorney, education power of attorney, health care proxy, HIPAA
  // authorization, and (when elected) living will — plus an optional simple
  // will (residue to the parents) when the family asks for one. Nothing else
  // on the estate side of this list applies.
  if (isCollegePrepDesignSheet(sheet)) {
    const collegePrep = getCollegePrepDesign(sheet)
    return {
      trust: false,
      // The will-cp simple will, on only when elected in the College
      // Preparation Plan section — same pattern as the FERPA release.
      will: collegePrep.will_include === true,
      dpoa: true,
      healthcare: true,
      deed: false,
      young_adult_estate_plan: false,
      // Education records sit outside HIPAA, so the release is a separate
      // document — and only when the student asked for one.
      ferpa_release: collegePrep.ferpa_release === true,
      education_poa: true,
      spouse_docs: false,
    }
  }

  return {
    trust: hasPlanType ? designPlanTypeIncludesRevocableTrust(normalizedPlanType) : true,
    will: true,
    dpoa: true,
    healthcare: true,
    deed: false,
    young_adult_estate_plan: hasYoungAdultChild,
    // A FERPA release and the education power of attorney belong to the
    // College Preparation Plan; an estate client has neither.
    ferpa_release: false,
    education_poa: false,
    spouse_docs: isMarried,
  }
}

export function getDocumentInclusions(sheet: Pick<DesignSheet, 'plan_type' | 'marital_status' | 'decisions'> & Partial<Pick<DesignSheet, 'children'>>): DesignDocumentInclusions {
  const defaults = defaultDocumentInclusions(sheet)
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = isRecord(decisions.document_inclusions) ? decisions.document_inclusions : {}

  return {
    trust: typeof raw.trust === 'boolean' ? raw.trust : defaults.trust,
    will: typeof raw.will === 'boolean' ? raw.will : defaults.will,
    dpoa: typeof raw.dpoa === 'boolean' ? raw.dpoa : defaults.dpoa,
    healthcare: typeof raw.healthcare === 'boolean' ? raw.healthcare : defaults.healthcare,
    deed: typeof raw.deed === 'boolean' ? raw.deed : defaults.deed,
    young_adult_estate_plan: typeof raw.young_adult_estate_plan === 'boolean'
      ? raw.young_adult_estate_plan
      : defaults.young_adult_estate_plan,
    ferpa_release: typeof raw.ferpa_release === 'boolean' ? raw.ferpa_release : defaults.ferpa_release,
    education_poa: typeof raw.education_poa === 'boolean' ? raw.education_poa : defaults.education_poa,
    spouse_docs: typeof raw.spouse_docs === 'boolean' ? raw.spouse_docs : defaults.spouse_docs,
  }
}

/**
 * Trust structure for an individual (non-joint) revocable trust. `disclaimer`
 * selects the married-individual disclaimer trust (outright to spouse with a
 * Marital/Family split on disclaimer); `standard` is the plain individual RLT.
 * Stored in `decisions` JSONB alongside `document_inclusions` — no dedicated
 * column.
 */
export type TrustPlanningType =
  | 'standard'
  | 'outright_to_spouse'
  | 'disclaimer'
  | 'clayton_election'

export function getTrustPlanningType(sheet: Pick<DesignSheet, 'decisions'>): TrustPlanningType {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const value = decisions.trust_planning_type
  if (value === 'disclaimer') return 'disclaimer'
  if (value === 'clayton_election') return 'clayton_election'
  // Legacy persisted value before spousal funding options expanded.
  if (value === 'standard') return 'outright_to_spouse'
  return 'outright_to_spouse'
}

export function setTrustPlanningType(
  sheet: Pick<DesignSheet, 'decisions'>,
  value: TrustPlanningType,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}

  return {
    ...decisions,
    trust_planning_type: value,
  }
}

export function setDocumentInclusion(
  sheet: Pick<DesignSheet, 'decisions'>,
  key: keyof DesignDocumentInclusions,
  value: boolean,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = isRecord(decisions.document_inclusions) ? decisions.document_inclusions : {}

  return {
    ...decisions,
    document_inclusions: {
      ...current,
      [key]: value,
    },
  }
}

/** Apply multiple decisions patches in sequence so batched UI updates do not clobber each other. */
export function mergeDecisionUpdates(
  sheet: Pick<DesignSheet, 'decisions'>,
  ...updates: Array<(current: Pick<DesignSheet, 'decisions'>) => Record<string, unknown>>
): Record<string, unknown> {
  let current: Pick<DesignSheet, 'decisions'> = sheet
  for (const update of updates) {
    const nextDecisions = update(current)
    current = { decisions: nextDecisions }
  }
  return isRecord(current.decisions) ? current.decisions : {}
}

function defaultWillTitle(inclusions: Pick<DesignDocumentInclusions, 'trust'>): EstatePlanWillTitle {
  return inclusions.trust ? 'pour_over_will' : 'last_will'
}

function normalizeAncillaryDocuments(
  raw: Record<string, unknown>,
  trustIncluded: boolean,
  /**
   * Whether the client-facing extras (summary, signing guide, role guide) are on
   * by default. They ride along with every estate plan, but a College
   * Preparation Plan is four documents and a signing appointment — an estate
   * plan summary for it would describe a plan that does not exist.
   */
  planWideExtras = true,
): Record<EstatePlanAncillaryDocumentKey, boolean> {
  return {
    certificate_of_trust: typeof raw.certificate_of_trust === 'boolean' ? raw.certificate_of_trust : trustIncluded,
    assignment_of_personal_property: typeof raw.assignment_of_personal_property === 'boolean' ? raw.assignment_of_personal_property : trustIncluded,
    funding_instructions: typeof raw.funding_instructions === 'boolean' ? raw.funding_instructions : trustIncluded,
    funding_recommendation: typeof raw.funding_recommendation === 'boolean' ? raw.funding_recommendation : trustIncluded,
    homestead_trustee: typeof raw.homestead_trustee === 'boolean' ? raw.homestead_trustee : trustIncluded,
    trust_summary: typeof raw.trust_summary === 'boolean' ? raw.trust_summary : trustIncluded,
    estate_plan_summary: typeof raw.estate_plan_summary === 'boolean' ? raw.estate_plan_summary : planWideExtras,
    estate_plan_signing_guide: typeof raw.estate_plan_signing_guide === 'boolean' ? raw.estate_plan_signing_guide : planWideExtras,
    successor_trustee_checklist: typeof raw.successor_trustee_checklist === 'boolean' ? raw.successor_trustee_checklist : trustIncluded,
    fiduciary_role_guide: typeof raw.fiduciary_role_guide === 'boolean' ? raw.fiduciary_role_guide : planWideExtras,
    flowchart: typeof raw.flowchart === 'boolean' ? raw.flowchart : false,
    include_asset_spreadsheet: typeof raw.include_asset_spreadsheet === 'boolean' ? raw.include_asset_spreadsheet : false,
  }
}

export function getEstatePlanDesignSetup(
  sheet: Pick<DesignSheet, 'plan_type' | 'marital_status' | 'decisions'> & Partial<Pick<DesignSheet, 'children'>>,
): EstatePlanDesignSetup {
  const inclusions = getDocumentInclusions(sheet)
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = isRecord(decisions.estate_plan_design) ? decisions.estate_plan_design : {}

  return {
    trust: inclusions.trust,
    will: inclusions.will,
    power_of_attorney: inclusions.dpoa,
    health_care_proxy: typeof raw.health_care_proxy === 'boolean' ? raw.health_care_proxy : inclusions.healthcare,
    hipaa_authorization: typeof raw.hipaa_authorization === 'boolean' ? raw.hipaa_authorization : inclusions.healthcare,
    living_will: typeof raw.living_will === 'boolean' ? raw.living_will : inclusions.healthcare,
    will_title: raw.will_title === 'last_will' || raw.will_title === 'pour_over_will'
      ? raw.will_title
      : defaultWillTitle(inclusions),
    signing_type: raw.signing_type === 'attorney_supervised' || raw.signing_type === 'independent_client'
      ? raw.signing_type
      : 'undecided',
    ancillary_documents: normalizeAncillaryDocuments(
      isRecord(raw.ancillary_documents) ? raw.ancillary_documents : {},
      inclusions.trust,
      !isCollegePrepDesignSheet(sheet),
    ),
  }
}

export function setEstatePlanDesignSetup(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<EstatePlanDesignSetup>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = isRecord(decisions.estate_plan_design) ? decisions.estate_plan_design : {}
  const next = {
    ...current,
    ...patch,
  }

  return {
    ...decisions,
    estate_plan_design: next,
  }
}

// Note: an orphaned `decisions.fiduciary_display_options` namespace used to
// live here with zero callers. Drafting reads
// `decisions.fiduciary_document_inclusions` (lib/designSheet/
// fiduciaryDocumentInclusions.ts) — that is the real display-toggle store.
