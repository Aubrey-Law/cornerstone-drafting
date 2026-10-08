import { COLLEGE_PREP_STEPS, getStepIssues, type IntakeRow } from '@/lib/intakeSections'

export { COLLEGE_PREP_STEPS }

export function isCollegePrepStepId(stepId: string): boolean {
  return stepId.startsWith('cp_')
}

export function getCollegePrepStepIssues(stepId: string, data: IntakeRow) {
  return isCollegePrepStepId(stepId) ? getStepIssues(stepId, data) : []
}
