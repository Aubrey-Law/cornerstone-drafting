import type { EngagementLegalPlan, EngagementPracticeArea } from './types'

export interface AgreementDefinition {
  practiceArea: EngagementPracticeArea
  legalPlan: EngagementLegalPlan | null
  scopeKeys: readonly string[]
  optionalClauseKeys: readonly string[]
}

const STANDARD_SCOPE = ['standard'] as const

export function agreementDefinitionFor(
  practiceArea: EngagementPracticeArea,
  legalPlan: EngagementLegalPlan | null,
): AgreementDefinition {
  return {
    practiceArea,
    legalPlan,
    scopeKeys: STANDARD_SCOPE,
    // Add keys only after the corresponding clause language is approved.
    optionalClauseKeys: [],
  }
}
