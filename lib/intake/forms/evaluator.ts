import { type FormFieldId, getFormField, readFormField, isDiscoveryField, discoveryFieldError } from '@/lib/discovery/catalog'
import { validateSharedField, type BuilderFieldDef } from '@aubrey-law/estate-fields/core'
import type { IntakeRow, IntakeSectionIssue } from '@/lib/intakeSections'
import { getIntakeTrack } from '@/lib/intakeTrack'
import { fractionalAgeFromDob } from '@/lib/youngAdultEstatePlan'
import { evaluateIntakeBlock, type IntakeSectionIssueDraft } from './blockRegistry'
import { evaluateIntakeCondition } from './conditions'
import type { CompiledIntakeForm, CompiledIntakeItem, CompiledIntakeSection } from './compiler'

export interface EvaluatedIntakeItem { id: string; item: CompiledIntakeItem; complete: boolean; issues: IntakeSectionIssue[] }
export interface EvaluatedIntakeSection extends Omit<CompiledIntakeSection, 'items'> {
  section: CompiledIntakeSection
  items: EvaluatedIntakeItem[]
  complete: boolean
  issues: IntakeSectionIssue[]
  timeEstimate: number
}
export interface IntakeFormEvaluation {
  activeSections: EvaluatedIntakeSection[]
  requiredSections: EvaluatedIntakeSection[]
  issues: IntakeSectionIssue[]
  submissionErrors: IntakeSectionIssue[]
  completedRequired: number
  percentComplete: number
  remainingMinutes: number
}

const CONTACT_FIELDS = new Set<FormFieldId>(['client_first_name', 'client_last_name', 'client_email', 'client_phone'])
function set(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return !!value.trim()
  if (Array.isArray(value)) return value.length > 0
  return true
}
function answered(field: BuilderFieldDef, value: unknown): boolean {
  if (field.control === 'boolean') return typeof value === 'boolean'
  if (field.control === 'multiselect') return Array.isArray(value) && value.length > 0
  return typeof value === 'string' && !!value.trim()
}

function validateBuilderValue(field: BuilderFieldDef, id: FormFieldId, value: unknown): string | null {
  if (isDiscoveryField(id) && field.control === 'select' && typeof value === 'string' && value.trim()) return null
  if (field.control === 'select' && field.intakeOptionValidation === 'legacy_presence') return null
  if (field.control === 'select' && field.options?.length) {
    const normalized = field.normalize ? field.normalize(value) : value
    return [...field.options.map((option) => option.value), ...(field.legacyValues ?? [])].includes(String(normalized))
      ? null : `Select a valid ${field.label.toLowerCase()}.`
  }
  return isDiscoveryField(id) ? discoveryFieldError(id, value) : validateSharedField(id, value)
}

/** Copy and core submission rules are code-owned; form JSON cannot supply them. */
function missingMessage(id: FormFieldId, college: boolean, label: string): string {
  const messages: Partial<Record<FormFieldId, string>> = {
    client_first_name: college ? "Enter the student's first name." : 'Enter your first name.',
    client_last_name: college ? "Enter the student's last name." : 'Enter your last name.',
    client_email: college ? "Enter the student's email address." : 'Enter your email address.',
    client_phone: college ? "Enter the student's cell phone number." : 'Enter your phone number.',
    client_dob: college ? "Enter the student's date of birth." : 'Enter your date of birth.',
    county: college ? 'Select the Massachusetts county of the permanent address.' : 'Select your Massachusetts county.',
    marital_status: 'Select your marital status.',
    has_children: 'Answer whether you have children.',
    has_minor_children: 'Answer whether any of your children are under 18.',
    estate_value: 'Select an estimated total estate value.',
    planning_goals: 'Select at least one estate planning goal.',
    college_school_name: 'Enter the college, university, or program.',
    college_school_city: 'Enter the campus city and state — an out-of-state campus changes which forms providers there will accept.',
    college_move_in_date: 'Enter the move-in or orientation date if you know it, so we can work back from that deadline.',
    college_ferpa_release: 'Answer whether the student wants a FERPA release for school records.',
    college_ferpa_records: 'Select which school records the FERPA release should cover.',
    college_dpoa_effective: 'Choose when the power of attorney takes effect.',
    college_dpoa_powers: 'Select the powers to grant, or choose “Discuss at the meeting” above.',
    college_hipaa_scope: 'Choose what health information may be released.',
    college_hipaa_excluded_categories: 'Select at least one category to withhold, or choose “All health information”.',
    college_hipaa_expiration: 'Choose when the HIPAA authorization expires.',
    college_hipaa_expiration_date: 'Enter the date the HIPAA authorization should expire.',
    college_living_will_include: 'Choose whether to include a living will.',
    college_life_support: 'Choose the student’s instruction about life-sustaining treatment.',
    college_organ_donation: 'Answer the organ donation question, or mark it to discuss.',
  }
  return messages[id] ?? `Answer ${label.toLowerCase()}.`
}

function scalarIssues(item: Extract<CompiledIntakeItem, { kind: 'field' }>, field: BuilderFieldDef, data: IntakeRow, activeFields: Set<FormFieldId>, activeFormFields: Set<FormFieldId>): IntakeSectionIssueDraft[] {
  const value = readFormField(item.fieldId, data)
  const college = getIntakeTrack(data) === 'college_prep'
  const blocking = CONTACT_FIELDS.has(item.fieldId) || (isDiscoveryField(item.fieldId) && item.effectiveRequirement === 'required')
  const missing = !answered(field, value)
    || (item.fieldId === 'college_school_city' && activeFields.has('college_school_state') && !set(readFormField('college_school_state', data)))
  const severity = blocking || item.effectiveRequirement === 'required' || item.fieldId === 'client_dob' || item.fieldId === 'county' ? 'error' : 'warning'
  const issues: IntakeSectionIssueDraft[] = []
  // The powers question remains visible before timing is chosen, but its
  // existing nudge applies only after a timing answer. Keep this canonical
  // cross-field rule in code, independently of form visibility/requiredness.
  const requirementActive = item.fieldId !== 'college_dpoa_powers'
    || item.effectiveRequirement !== 'recommended'
    || !activeFormFields.has('college_dpoa_effective')
    || set(readFormField('college_dpoa_effective', data))
  if (missing && requirementActive && (blocking || item.effectiveRequirement !== 'optional')) issues.push({ message: missingMessage(item.fieldId, college, field.label), severity, ...(blocking ? { blocksSubmission: true } : {}) })
  if (!missing) {
    // Use catalog validation, including retired values; no user-defined format rules.
    const error = validateBuilderValue(field, item.fieldId, value)
    if (error) issues.push({ message: error, severity: 'error', ...(blocking ? { blocksSubmission: true } : {}) })
    if (college && item.fieldId === 'client_dob') {
      const age = fractionalAgeFromDob(String(value))
      if (age !== null && age < 18) issues.push({ message: 'The student is under 18. These documents can only be signed on or after their eighteenth birthday — we will schedule around it.', severity: 'warning' })
    }
  }
  return issues
}

/** One condition/validation result drives display, progress, review, and submit. */
export function evaluateCompiledIntakeForm(form: CompiledIntakeForm, data: IntakeRow): IntakeFormEvaluation {
  const resolve = (fieldId: FormFieldId) => readFormField(fieldId, data)
  const activeContent = form.sections.filter((section) => evaluateIntakeCondition(section.condition, resolve)).map((section) => ({
    section, activeItems: section.items.filter((item) => evaluateIntakeCondition(item.condition, resolve)),
  }))
  const activeFormFields = new Set(activeContent.flatMap(({ activeItems }) => activeItems.flatMap((item) => item.kind === 'field' ? [item.fieldId] : [])))
  const activeSections = activeContent.map(({ section, activeItems }): EvaluatedIntakeSection => {
    const activeFields = new Set(activeItems.flatMap((item) => item.kind === 'field' ? [item.fieldId] : []))
    const items = activeItems.map((item): EvaluatedIntakeItem => {
      const result = item.kind === 'block' ? evaluateIntakeBlock(item.blockId, item.config, data) : (() => {
        const field = getFormField(item.fieldId)
        const issues = scalarIssues(item, field, data, activeFields, activeFormFields)
        return { issues, complete: issues.every((issue) => issue.severity !== 'error') }
      })()
      return { id: item.id, item, complete: result.complete, issues: result.issues.map((issue) => ({ sectionId: section.id, sectionTitle: section.title, ...issue })) }
    })
    const issues = items.flatMap((item) => item.issues)
    const complete = section.optional && items.every((entry) => entry.item.kind === 'field' && entry.item.effectiveRequirement === 'optional')
      ? items.every((entry) => entry.complete) && items.some((entry) => entry.item.kind === 'field' && set(resolve(entry.item.fieldId)))
      : items.every((item) => item.complete)
    return { ...section, section, items, issues, complete, timeEstimate: section.timeEstimateMinutes ?? 0 }
  })
  const requiredSections = activeSections.filter((section) => !section.optional && !section.items.every((entry) => entry.item.kind === 'block' && entry.item.blockId === 'review_submit'))
  const issues = activeSections.flatMap((section) => section.issues)
  const completedRequired = requiredSections.filter((section) => section.complete).length
  return { activeSections, requiredSections, issues, submissionErrors: issues.filter((issue) => issue.severity === 'error' && issue.blocksSubmission === true), completedRequired,
    percentComplete: requiredSections.length ? Math.round(completedRequired / requiredSections.length * 100) : 0,
    remainingMinutes: activeSections.filter((section) => !section.complete).reduce((sum, section) => sum + section.timeEstimate, 0) }
}
