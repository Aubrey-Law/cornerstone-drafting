import { compileBundledIntakeForm, evaluateBundledIntakeForm } from '@/lib/intake/forms/definitions'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import type { CompiledIntakeForm, CompiledIntakeSection } from '@/lib/intake/forms/compiler'
import { evaluateIntakeCondition } from '@/lib/intake/forms/conditions'
import { readBuilderFieldValue } from '@aubrey-law/estate-fields/core'
import { getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'
import type { IntakeRow, IntakeSectionIssue, IntakeStep, SectionStatus } from '@/lib/intake/legacySections'

export type { IntakeRow, IntakeSectionIssue, IntakeStep, SectionStatus, IntakeIssueSeverity } from '@/lib/intake/legacySections'

function bundledForm(track: IntakeTrack): CompiledIntakeForm {
  const result = compileBundledIntakeForm(track, 'client')
  if (!result.success) throw new Error(`Invalid bundled intake form ${track}: ${result.errors.map(({ path, message }) => `${path}: ${message}`).join('; ')}`)
  return result.form
}

const forms = { estate: bundledForm('estate'), college_prep: bundledForm('college_prep') }

/** Direct step lookup historically evaluates even a currently hidden section.
 * Active progress and submission still use the normal condition-filtered form. */
function evaluateStep(section: CompiledIntakeSection, track: IntakeTrack, data: IntakeRow) {
  const form = forms[track]
  const sections = form.sections.map((entry) => entry.id === section.id ? { ...entry, condition: undefined } : entry)
  return evaluateCompiledIntakeForm({ ...form, sections }, { ...data, intake_track: track }).activeSections.find((entry) => entry.id === section.id)!
}

function toCompatibilityStep(section: CompiledIntakeSection, track: IntakeTrack): IntakeStep {
  return {
    id: section.id,
    title: section.title,
    subtitle: section.subtitle ?? '',
    timeEstimate: section.timeEstimateMinutes ?? 0,
    ...(section.optional === undefined ? {} : { optional: section.optional }),
    ...(section.condition ? { condition: (data: IntakeRow) => evaluateIntakeCondition(section.condition, (id) => readBuilderFieldValue(id, data)) } : {}),
    isComplete: (data) => evaluateStep(section, track, data).complete,
  }
}

// These legacy public names now contain compiled-definition compatibility steps.
export const INTAKE_STEPS: IntakeStep[] = forms.estate.sections.map((section) => toCompatibilityStep(section, 'estate'))
export const COLLEGE_PREP_STEPS: IntakeStep[] = forms.college_prep.sections.map((section) => toCompatibilityStep(section, 'college_prep'))

export function getActiveSteps(data: IntakeRow): IntakeStep[] {
  const track = getIntakeTrack(data)
  return evaluateBundledIntakeForm(track, 'client', data).activeSections.map(({ section }) => toCompatibilityStep(section, track))
}

export function getRequiredSteps(data: IntakeRow): IntakeStep[] {
  const track = getIntakeTrack(data)
  return evaluateBundledIntakeForm(track, 'client', data).requiredSections.map(({ section }) => toCompatibilityStep(section, track))
}

export function getStepById(id: string): IntakeStep | undefined {
  return INTAKE_STEPS.find((step) => step.id === id) ?? COLLEGE_PREP_STEPS.find((step) => step.id === id)
}

export function getStepIssues(stepId: string, data: IntakeRow): IntakeSectionIssue[] {
  const track = stepId.startsWith('cp_') ? 'college_prep' : 'estate'
  const section = forms[track].sections.find((entry) => entry.id === stepId)
  return section ? evaluateStep(section, track, data).issues : []
}

export function getStepErrors(stepId: string, data: IntakeRow): IntakeSectionIssue[] {
  return getStepIssues(stepId, data).filter((issue) => issue.severity === 'error')
}

export function getSubmissionIssues(data: IntakeRow): IntakeSectionIssue[] {
  return evaluateBundledIntakeForm(getIntakeTrack(data), 'client', data).requiredSections.flatMap((section) => section.issues)
}

export function getSubmissionErrors(data: IntakeRow): IntakeSectionIssue[] {
  return evaluateBundledIntakeForm(getIntakeTrack(data), 'client', data).submissionErrors
}

export function isReadyToReview(data: IntakeRow): boolean {
  return getSubmissionErrors(data).length === 0
}

export function getSectionStatus(step: IntakeStep, data: IntakeRow): SectionStatus {
  return step.isComplete(data) ? 'complete' : 'not_started'
}

export function nextIncompleteSection(data: IntakeRow): IntakeStep {
  const active = getActiveSteps(data)
  return active.find((step) => !step.optional && !step.isComplete(data)) ?? active[active.length - 1]
}

export function formatSubmissionIssueList(issues: IntakeSectionIssue[]): string {
  return issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.sectionTitle}: ${issue.message}`).join('\n')
}

export function isSectionAccessible(step: IntakeStep, data: IntakeRow): boolean {
  const active = getActiveSteps(data)
  const index = active.findIndex((entry) => entry.id === step.id)
  return index <= 0 || active.slice(0, index).every((entry) => entry.isComplete(data)) || active.slice(0, index + 1).some((entry) => entry.isComplete(data))
}
