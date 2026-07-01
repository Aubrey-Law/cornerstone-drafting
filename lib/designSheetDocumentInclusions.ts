import { designPlanTypeIncludesTrust, normalizeDesignPlanType } from '@/lib/designPlanType'
import { hasYoungAdultEstatePlanChild } from '@/lib/youngAdultEstatePlan'
import type { DesignSheet } from '@/types/database'

export type DesignDocumentKey = 'trust' | 'will' | 'dpoa' | 'healthcare' | 'deed' | 'young_adult_estate_plan'

export type DesignDocumentInclusions = Record<DesignDocumentKey, boolean> & {
  spouse_docs: boolean
}

export const DESIGN_DOCUMENT_LABELS: Record<DesignDocumentKey, string> = {
  trust: 'Trust',
  will: 'Will',
  dpoa: 'Durable Power of Attorney',
  healthcare: 'Health Care Documents',
  deed: 'Deed',
  young_adult_estate_plan: 'Young Adult Estate Plan',
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
export type TrustPlanningType = 'standard' | 'disclaimer'

export function getTrustPlanningType(sheet: Pick<DesignSheet, 'decisions'>): TrustPlanningType {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  return decisions.trust_planning_type === 'disclaimer' ? 'disclaimer' : 'standard'
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
