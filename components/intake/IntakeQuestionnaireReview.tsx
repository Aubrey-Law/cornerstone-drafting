'use client'

import { getActiveSteps, getStepIssues } from '@/lib/intakeSections'
import { IntakeQuestionnaireReview as ReviewContent, type IntakeQuestionnaireReviewProps } from './IntakeQuestionnaireReviewContent'

export { IntakeDocumentUpload } from './IntakeQuestionnaireReviewContent'
export type { IntakeQuestionnaireReviewProps } from './IntakeQuestionnaireReviewContent'

const selectors = { getActiveSteps, getStepIssues }

/** Default callers use production selectors; rollback supplies its own through
 * the dependency-free content component. */
export function IntakeQuestionnaireReview(props: IntakeQuestionnaireReviewProps) {
  return <ReviewContent {...props} selectors={selectors} />
}
