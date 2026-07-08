import { designPlanTypeIncludesTrust, normalizeDesignPlanType } from '@/lib/designPlanType'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import type { DesignSheet } from '@/types/database'

export type DesignDocumentKey = 'trust' | 'will' | 'dpoa' | 'healthcare' | 'deed' | 'young_adult_estate_plan'

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

export interface FiduciaryDisplayOptions {
  show_phone_numbers: boolean
  show_addresses: boolean
  show_email_addresses: boolean
  show_dates_of_birth: boolean
  show_relationships: boolean
}

export const DESIGN_DOCUMENT_LABELS: Record<DesignDocumentKey, string> = {
  trust: 'Trust',
  will: 'Will',
  dpoa: 'Durable Power of Attorney',
  healthcare: 'Health Care Documents',
  deed: 'Deed',
  young_adult_estate_plan: 'Young Adult Estate Plan',
}

export const ESTATE_PLAN_ANCILLARY_LABELS: Record<EstatePlanAncillaryDocumentKey, string> = {
  certificate_of_trust: 'Certificate of Trust',
  assignment_of_personal_property: 'Assignment of Personal Property',
  funding_instructions: 'Funding Instructions',
  funding_recommendation: 'Funding Recommendation',
  trust_summary: 'Trust Summary',
  estate_plan_summary: 'Estate Plan Summary',
  estate_plan_signing_guide: 'Estate Plan Signing Guide',
  successor_trustee_checklist: 'Successor Trustee Checklist',
  fiduciary_role_guide: 'Fiduciary Role Guide',
  flowchart: 'Flowchart',
  include_asset_spreadsheet: 'Include Asset Spreadsheet',
}

const DEFAULT_FIDUCIARY_DISPLAY_OPTIONS: FiduciaryDisplayOptions = {
  show_phone_numbers: false,
  show_addresses: false,
  show_email_addresses: false,
  show_dates_of_birth: false,
  show_relationships: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function defaultDocumentInclusions(sheet: Pick<DesignSheet, 'plan_type' | 'marital_status'> & Partial<Pick<DesignSheet, 'children'>>): DesignDocumentInclusions {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const hasPlanType = normalizedPlanType !== null
  const isMarried = (sheet.marital_status ?? '').toLowerCase().includes('married')
  const hasYoungAdultChild = hasYoungAdultEstatePlanChild(sheet.children)

  return {
    trust: hasPlanType ? designPlanTypeIncludesTrust(normalizedPlanType) : true,
    will: true,
    dpoa: true,
    healthcare: true,
    deed: false,
    young_adult_estate_plan: hasYoungAdultChild,
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
export type TrustPlanningType = 'outright_to_spouse' | 'disclaimer' | 'clayton_election'

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

function defaultWillTitle(inclusions: Pick<DesignDocumentInclusions, 'trust'>): EstatePlanWillTitle {
  return inclusions.trust ? 'pour_over_will' : 'last_will'
}

function normalizeAncillaryDocuments(
  raw: Record<string, unknown>,
  trustIncluded: boolean,
): Record<EstatePlanAncillaryDocumentKey, boolean> {
  return {
    certificate_of_trust: typeof raw.certificate_of_trust === 'boolean' ? raw.certificate_of_trust : trustIncluded,
    assignment_of_personal_property: typeof raw.assignment_of_personal_property === 'boolean' ? raw.assignment_of_personal_property : trustIncluded,
    funding_instructions: typeof raw.funding_instructions === 'boolean' ? raw.funding_instructions : trustIncluded,
    funding_recommendation: typeof raw.funding_recommendation === 'boolean' ? raw.funding_recommendation : trustIncluded,
    trust_summary: typeof raw.trust_summary === 'boolean' ? raw.trust_summary : trustIncluded,
    estate_plan_summary: typeof raw.estate_plan_summary === 'boolean' ? raw.estate_plan_summary : true,
    estate_plan_signing_guide: typeof raw.estate_plan_signing_guide === 'boolean' ? raw.estate_plan_signing_guide : true,
    successor_trustee_checklist: typeof raw.successor_trustee_checklist === 'boolean' ? raw.successor_trustee_checklist : trustIncluded,
    fiduciary_role_guide: typeof raw.fiduciary_role_guide === 'boolean' ? raw.fiduciary_role_guide : true,
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

export function getFiduciaryDisplayOptions(sheet: Pick<DesignSheet, 'decisions'>): FiduciaryDisplayOptions {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = isRecord(decisions.fiduciary_display_options) ? decisions.fiduciary_display_options : {}

  return {
    show_phone_numbers: typeof raw.show_phone_numbers === 'boolean' ? raw.show_phone_numbers : DEFAULT_FIDUCIARY_DISPLAY_OPTIONS.show_phone_numbers,
    show_addresses: typeof raw.show_addresses === 'boolean' ? raw.show_addresses : DEFAULT_FIDUCIARY_DISPLAY_OPTIONS.show_addresses,
    show_email_addresses: typeof raw.show_email_addresses === 'boolean' ? raw.show_email_addresses : DEFAULT_FIDUCIARY_DISPLAY_OPTIONS.show_email_addresses,
    show_dates_of_birth: typeof raw.show_dates_of_birth === 'boolean' ? raw.show_dates_of_birth : DEFAULT_FIDUCIARY_DISPLAY_OPTIONS.show_dates_of_birth,
    show_relationships: typeof raw.show_relationships === 'boolean' ? raw.show_relationships : DEFAULT_FIDUCIARY_DISPLAY_OPTIONS.show_relationships,
  }
}

export function setFiduciaryDisplayOptions(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<FiduciaryDisplayOptions>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const current = isRecord(decisions.fiduciary_display_options) ? decisions.fiduciary_display_options : {}

  return {
    ...decisions,
    fiduciary_display_options: {
      ...current,
      ...patch,
    },
  }
}
