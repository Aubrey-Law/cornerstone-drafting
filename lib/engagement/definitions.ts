import type { EngagementLegalPlan, EngagementPracticeArea } from './types'

export interface AgreementDefinition {
  practiceArea: EngagementPracticeArea
  legalPlan: EngagementLegalPlan | null
  scopeKeys: readonly string[]
  optionalClauseKeys: readonly string[]
}

const STANDARD_SCOPE = ['standard'] as const

/**
 * The optional services the LP letter's addendum offers, in the order its table
 * lists them. Keys, not prices: the price and the description live in the
 * master, so changing either is a new template version rather than a code change.
 */
export const LP_OPTIONAL_SERVICE_KEYS = ['credit_shelter_planning', 'deed_recording'] as const
export type LpOptionalServiceKey = (typeof LP_OPTIONAL_SERVICE_KEYS)[number]

/** Names only — the addendum's own table is where a service's fee is stated. */
export const OPTIONAL_CLAUSE_LABELS: Record<string, string> = {
  credit_shelter_planning: 'Credit Shelter Planning',
  deed_recording: 'Deed Recording',
}

export function agreementDefinitionFor(
  practiceArea: EngagementPracticeArea,
  legalPlan: EngagementLegalPlan | null,
): AgreementDefinition {
  return {
    practiceArea,
    legalPlan,
    scopeKeys: STANDARD_SCOPE,
    // Add keys only after the corresponding clause language is approved.
    optionalClauseKeys: practiceArea === 'EP-LP' ? LP_OPTIONAL_SERVICE_KEYS : [],
  }
}
