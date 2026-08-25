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

/**
 * How the health care directive is titled. Massachusetts drafts a Health Care
 * Proxy, so `state_default` is the answer for almost every matter; the rest
 * exist because the interview form asks and some clients arrive with a
 * preference from another state.
 */
export type EstatePlanHealthcareDirectiveTitle =
  | 'state_default'
  | 'advance_directive'
  | 'advance_health_care_directive'
  | 'health_care_directive'
  | 'health_care_power_of_attorney'
  | 'other'

export type EstatePlanPoaForm = 'short' | 'long' | 'both'
export type EstatePlanPoaTitle = 'power_of_attorney' | 'durable_power_of_attorney'

export type EstatePlanComprehensiveTransferTitle =
  | 'declaration_of_trust'
  | 'comprehensive_transfer_of_assets'
  | 'general_assignment'

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
  // Record-only: the design sheet captures the decision and the interview
  // worksheet prints it, but no template drafts these yet. Labelled as such in
  // the UI so a ticked box is not read as a promised document.
  | 'dementia_directive'
  | 'visitation_authorization'
  | 'final_disposition'
  | 'comprehensive_transfer_document'
  | 'client_self_declaration_of_capacity'

export interface EstatePlanDesignSetup {
  trust: boolean
  will: boolean
  power_of_attorney: boolean
  health_care_proxy: boolean
  hipaa_authorization: boolean
  living_will: boolean
  will_title: EstatePlanWillTitle
  signing_type: EstatePlanSigningType
  healthcare_directive_title: EstatePlanHealthcareDirectiveTitle
  poa_form: EstatePlanPoaForm
  poa_title: EstatePlanPoaTitle
  comprehensive_transfer_title: EstatePlanComprehensiveTransferTitle | null
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
  dementia_directive: 'Dementia Directive',
  visitation_authorization: 'Visitation Authorization',
  final_disposition: 'Final Disposition Instructions',
  comprehensive_transfer_document: 'Comprehensive Transfer Document',
  client_self_declaration_of_capacity: 'Client Self-Declaration of Capacity',
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
  /**
   * The residuary skips the surviving spouse entirely. Package selection only
   * branches on `disclaimer`, so this falls through to `trust-individual-single`
   * exactly as `outright_to_spouse` does — the difference is in how the trust
   * disposes the residuary, which `trust.descendants_distribution` already
   * carries. Adding this value therefore changes what the documents say, not
   * which documents are produced.
   */
  | 'not_to_spouse'

export function getTrustPlanningType(sheet: Pick<DesignSheet, 'decisions'>): TrustPlanningType {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const value = decisions.trust_planning_type
  if (value === 'disclaimer') return 'disclaimer'
  if (value === 'clayton_election') return 'clayton_election'
  if (value === 'not_to_spouse') return 'not_to_spouse'
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
    dementia_directive: typeof raw.dementia_directive === 'boolean' ? raw.dementia_directive : false,
    visitation_authorization: typeof raw.visitation_authorization === 'boolean' ? raw.visitation_authorization : false,
    final_disposition: typeof raw.final_disposition === 'boolean' ? raw.final_disposition : false,
    comprehensive_transfer_document: typeof raw.comprehensive_transfer_document === 'boolean' ? raw.comprehensive_transfer_document : false,
    client_self_declaration_of_capacity: typeof raw.client_self_declaration_of_capacity === 'boolean' ? raw.client_self_declaration_of_capacity : false,
  }
}

const HEALTHCARE_DIRECTIVE_TITLES: readonly EstatePlanHealthcareDirectiveTitle[] = [
  'state_default', 'advance_directive', 'advance_health_care_directive',
  'health_care_directive', 'health_care_power_of_attorney', 'other',
]
const POA_FORMS: readonly EstatePlanPoaForm[] = ['short', 'long', 'both']
const POA_TITLES: readonly EstatePlanPoaTitle[] = ['power_of_attorney', 'durable_power_of_attorney']
const COMPREHENSIVE_TRANSFER_TITLES: readonly EstatePlanComprehensiveTransferTitle[] = [
  'declaration_of_trust', 'comprehensive_transfer_of_assets', 'general_assignment',
]

function readTitle<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
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
    // On a College Preparation Plan the student's own answer is the decision.
    // `estate_plan_design.living_will` is only a mirror of it, written once at
    // seed time, so reading the mirror meant an answer changed later in the
    // design sheet (declined at intake, elected at the meeting) never reached
    // the generator and the advance directive silently never drafted. A
    // deferred answer keeps the document — dropping one the student has not
    // declined is the harder mistake to catch, and readiness blocks drafting
    // until it is resolved either way.
    living_will: isCollegePrepDesignSheet(sheet)
      ? getCollegePrepDesign(sheet).living_will_include !== 'no'
      : typeof raw.living_will === 'boolean' ? raw.living_will : inclusions.healthcare,
    will_title: raw.will_title === 'last_will' || raw.will_title === 'pour_over_will'
      ? raw.will_title
      : defaultWillTitle(inclusions),
    signing_type: raw.signing_type === 'attorney_supervised' || raw.signing_type === 'independent_client'
      ? raw.signing_type
      : 'undecided',
    // The firm drafts a Massachusetts Health Care Proxy and a long-form durable
    // power of attorney, so these default to the answer the firm gives rather
    // than to null: an unanswered question here has a right answer.
    healthcare_directive_title: readTitle(raw.healthcare_directive_title, HEALTHCARE_DIRECTIVE_TITLES, 'state_default'),
    poa_form: readTitle(raw.poa_form, POA_FORMS, 'long'),
    poa_title: readTitle(raw.poa_title, POA_TITLES, 'durable_power_of_attorney'),
    // No default: the comprehensive transfer document is record-only and off by
    // default, so a title before the document is chosen would be a fiction.
    comprehensive_transfer_title: typeof raw.comprehensive_transfer_title === 'string'
      && (COMPREHENSIVE_TRANSFER_TITLES as readonly string[]).includes(raw.comprehensive_transfer_title)
      ? raw.comprehensive_transfer_title as EstatePlanComprehensiveTransferTitle
      : null,
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
