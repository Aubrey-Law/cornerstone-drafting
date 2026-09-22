import type { EngagementLegalPlan, EngagementPracticeArea } from './types'

export interface AgreementDefinition {
  practiceArea: EngagementPracticeArea
  legalPlan: EngagementLegalPlan | null
  scopeKeys: readonly string[]
}

const STANDARD_SCOPE = ['standard'] as const

export function agreementDefinitionFor(
  practiceArea: EngagementPracticeArea,
  legalPlan: EngagementLegalPlan | null,
): AgreementDefinition {
  return { practiceArea, legalPlan, scopeKeys: STANDARD_SCOPE }
}

/**
 * The optional services a master's addendum can offer.
 *
 * Which of them a given agreement offers is the master's own answer
 * (`optionalServiceKeys` in lib/engagement/templates.ts), because the addendum
 * table is printed in the document: a service a master does not list cannot be
 * elected on it, whatever the practice area.
 *
 * `checkboxTag` is the merge field the master carries for that row. Prices and
 * descriptions are not here — they are printed in the addendum, so changing one
 * is a new template version rather than a code change.
 */
export interface OptionalService {
  label: string
  checkboxTag: string
}

export const OPTIONAL_SERVICES: Record<string, OptionalService> = {
  credit_shelter_planning: { label: 'Credit Shelter Planning', checkboxTag: 'credit_shelter_checkbox' },
  deed_recording: { label: 'Deed Recording', checkboxTag: 'deed_recording_checkbox' },
}
