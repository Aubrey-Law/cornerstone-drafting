export type IntakeRow = Record<string, unknown>

import { validateIntakeField } from '@/lib/sharedFields/intakeValidate'

export interface IntakeStep {
  id: string
  title: string
  subtitle: string
  timeEstimate: number
  optional?: boolean
  condition?: (data: IntakeRow) => boolean
  isComplete: (data: IntakeRow) => boolean
}

export type IntakeIssueSeverity = 'error' | 'warning'

export interface IntakeSectionIssue {
  sectionId: string
  sectionTitle: string
  message: string
  severity: IntakeIssueSeverity
}

export const INTAKE_STEPS: IntakeStep[] = [
  {
    id: 'referral',
    title: 'Getting Started',
    subtitle: 'How did you find us?',
    timeEstimate: 1,
    optional: true,
    isComplete: (r) => !!text(r, 'referral_source'),
  },
  {
    id: 'personal',
    title: 'Personal Information',
    subtitle: 'Name, contact & address',
    timeEstimate: 5,
    isComplete: (r) => isStepComplete('personal', r),
  },
  {
    id: 'family',
    title: 'Family',
    subtitle: 'Marital status & dependents',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('family', r),
  },
  {
    id: 'spouse',
    title: 'Spouse Information',
    subtitle: "Spouse's details",
    timeEstimate: 3,
    condition: (r) => r.marital_status === 'married',
    isComplete: (r) => isStepComplete('spouse', r),
  },
  {
    id: 'children',
    title: 'Children',
    subtitle: "Children's information",
    timeEstimate: 3,
    condition: (r) => r.has_children === true,
    isComplete: (r) => isStepComplete('children', r),
  },
  {
    id: 'estate',
    title: 'Financial',
    subtitle: 'Assets & financial overview',
    timeEstimate: 5,
    isComplete: (r) => isStepComplete('estate', r),
  },
  {
    id: 'goals',
    title: 'Goals & Wishes',
    subtitle: 'Priorities & special wishes',
    timeEstimate: 4,
    isComplete: (r) => isStepComplete('goals', r),
  },
  {
    id: 'additional_contacts',
    title: 'Additional Contacts',
    subtitle: 'Other people you may name as fiduciaries (optional)',
    timeEstimate: 3,
    optional: true,
    isComplete: (r) => getAdditionalContacts(r).length > 0,
  },
  {
    id: 'fiduciaries',
    title: 'Your Fiduciaries',
    subtitle: 'Trustees, agents & proxies',
    timeEstimate: 7,
    isComplete: (r) =>
      allFiduciariesNamed(r, ['fid_personal_rep_client', 'fid_poa_client', 'fid_hcp_client', 'fid_trustee_client']),
  },
  {
    id: 'spouse_fiduciaries',
    title: "Spouse's Fiduciaries",
    subtitle: "Spouse's trustees & agents",
    timeEstimate: 5,
    condition: (r) => r.marital_status === 'married',
    isComplete: (r) =>
      allFiduciariesNamed(r, ['fid_personal_rep_spouse', 'fid_poa_spouse', 'fid_hcp_spouse']),
  },
  {
    id: 'guardian',
    title: 'Guardian for Minors',
    subtitle: 'Care for minor children',
    timeEstimate: 2,
    condition: (r) => r.has_minor_children === true,
    isComplete: (r) => allFiduciariesNamed(r, ['fid_guardian_client']),
  },
  {
    id: 'review',
    title: 'Review & Submit',
    subtitle: 'Confirm & submit',
    timeEstimate: 2,
    isComplete: (r) => r.status === 'submitted' || r.status === 'approved',
  },
]

export function getActiveSteps(data: IntakeRow): IntakeStep[] {
  return INTAKE_STEPS.filter((s) => !s.condition || s.condition(data))
}

export type SectionStatus = 'not_started' | 'in_progress' | 'complete'

export function getSectionStatus(step: IntakeStep, data: IntakeRow): SectionStatus {
  if (step.isComplete(data)) return 'complete'
  // Heuristic: a section is "in_progress" once the user has at least started filling
  // any data for that section. We approximate by treating any non-default value
  // touched by step ordering as "in_progress" — for v1 we just look at completion.
  return 'not_started'
}

export function getStepById(id: string): IntakeStep | undefined {
  return INTAKE_STEPS.find((s) => s.id === id)
}

export function nextIncompleteSection(data: IntakeRow): IntakeStep {
  const active = getActiveSteps(data)
  return active.find((s) => !s.optional && !s.isComplete(data)) ?? active[active.length - 1]
}

export function getRequiredSteps(data: IntakeRow): IntakeStep[] {
  return getActiveSteps(data).filter((s) => !s.optional && s.id !== 'review')
}

export function isReadyToReview(data: IntakeRow): boolean {
  // Submission readiness is gated by blocking *errors* only — warning-severity
  // nudges (e.g. unnamed fiduciaries) don't prevent submitting. This stays
  // decoupled from each step's display `isComplete`, which may be stricter so
  // the sidebar checkmark only lights up once a section is genuinely filled in.
  return getSubmissionErrors(data).length === 0
}

export function getSubmissionIssues(data: IntakeRow): IntakeSectionIssue[] {
  return getRequiredSteps(data).flatMap((step) => getStepIssues(step.id, data))
}

export function getSubmissionErrors(data: IntakeRow): IntakeSectionIssue[] {
  return getSubmissionIssues(data).filter((issue) => issue.severity === 'error')
}

export function formatSubmissionIssueList(issues: IntakeSectionIssue[]): string {
  return issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.sectionTitle}: ${issue.message}`)
    .join('\n')
}

export function getStepIssues(stepId: string, data: IntakeRow): IntakeSectionIssue[] {
  const step = getStepById(stepId)
  if (!step) return []
  const issue = (message: string, severity: IntakeIssueSeverity = 'error'): IntakeSectionIssue => ({
    sectionId: step.id,
    sectionTitle: step.title,
    message,
    severity,
  })

  switch (stepId) {
    case 'referral': {
      return []
    }
    case 'personal': {
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'first_name')) issues.push(issue('Enter your first name.'))
      if (!text(data, 'last_name')) issues.push(issue('Enter your last name.'))
      const email = text(data, 'email')
      if (!email) issues.push(issue('Enter your email address.'))
      if (email) {
        const emailError = validateIntakeField('email', email)
        if (emailError) issues.push(issue(emailError))
      }
      if (!text(data, 'phone')) issues.push(issue('Enter your phone number.'))
      if (!streetAddress(data)) issues.push(issue('Enter your street address.'))
      if (!text(data, 'city')) issues.push(issue('Enter your city.'))
      if (!text(data, 'state')) issues.push(issue('Enter your state.'))
      if (!text(data, 'zip')) issues.push(issue('Enter your ZIP code.'))
      if (!text(data, 'county')) issues.push(issue('Select your Massachusetts county.', 'warning'))
      else {
        const countyError = validateIntakeField('county', data.county)
        if (countyError) issues.push(issue(countyError, 'warning'))
      }
      return issues
    }
    case 'family': {
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'marital_status')) issues.push(issue('Select your marital status.'))
      else {
        const maritalError = validateIntakeField('marital_status', data.marital_status)
        if (maritalError) issues.push(issue(maritalError))
      }
      if (!hasBoolean(data, 'has_children')) issues.push(issue('Answer whether you have children.'))
      if (data.has_children === true && !hasBoolean(data, 'has_minor_children')) {
        issues.push(issue('Answer whether any of your children are under 18.'))
      }
      return issues
    }
    case 'spouse': {
      const issues: IntakeSectionIssue[] = []
      if (!spouseText(data, 'first_name')) issues.push(issue("Enter your spouse's first name."))
      if (!spouseText(data, 'last_name')) issues.push(issue("Enter your spouse's last name."))
      if (!spouseText(data, 'date_of_birth')) issues.push(issue("Enter your spouse's date of birth if you have it, or leave this blank to discuss later.", 'warning'))
      return issues
    }
    case 'children': {
      const children = getChildren(data)
      if (children.length === 0) return [issue('Add at least one child.')]
      return children.flatMap((child, index) => {
        const childIssues: IntakeSectionIssue[] = []
        if (!recordText(child, 'first_name') || !recordText(child, 'last_name')) {
          childIssues.push(issue(`Enter first and last name for child ${index + 1}.`))
        }
        if (!recordText(child, 'date_of_birth')) {
          childIssues.push(issue(`Enter date of birth for child ${index + 1}.`, 'warning'))
        }
        return childIssues
      })
    }
    case 'estate': {
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'estate_value')) issues.push(issue('Select an estimated total estate value.'))
      else {
        const estateError = validateIntakeField('estate_value', data.estate_value)
        if (estateError) issues.push(issue(estateError))
      }
      if (arrayValue(data, 'asset_types').length === 0) {
        issues.push(issue('Select at least one asset type, or use Other Assets if none of the listed categories fit.'))
      }
      return issues
    }
    case 'goals': {
      const issues: IntakeSectionIssue[] = []
      if (goalValues(data).length === 0) issues.push(issue('Select at least one estate planning goal.'))
      if (!planningObjectiveText(data, 'why_now')) {
        issues.push(issue('Briefly explain why you are moving forward with estate planning now.', 'warning'))
      }
      return issues
    }
    case 'fiduciaries': {
      return [
        ...requiredFiduciaryIssue(data, 'fid_personal_rep_client', 'Name a Personal Representative if you know who you want, or leave this blank to discuss later.', 'warning'),
        ...requiredFiduciaryIssue(data, 'fid_poa_client', 'Name a Financial Power of Attorney if you know who you want, or leave this blank to discuss later.', 'warning'),
        ...requiredFiduciaryIssue(data, 'fid_hcp_client', 'Name a Health Care Proxy if you know who you want, or leave this blank to discuss later.', 'warning'),
        ...requiredFiduciaryIssue(data, 'fid_trustee_client', 'Name a Trustee if you know who you want, or leave this blank to discuss later.', 'warning'),
      ]
    }
    case 'spouse_fiduciaries': {
      return [
        ...requiredFiduciaryIssue(data, 'fid_personal_rep_spouse', "Name your spouse's Personal Representative if known, or leave this blank to discuss later.", 'warning'),
        ...requiredFiduciaryIssue(data, 'fid_poa_spouse', "Name your spouse's Financial Power of Attorney if known, or leave this blank to discuss later.", 'warning'),
        ...requiredFiduciaryIssue(data, 'fid_hcp_spouse', "Name your spouse's Health Care Proxy if known, or leave this blank to discuss later.", 'warning'),
      ]
    }
    case 'guardian':
      return requiredFiduciaryIssue(data, 'fid_guardian_client', 'Name a guardian if you know who you want, or leave this blank to discuss later.', 'warning')
    default:
      return []
  }
}

export function getStepErrors(stepId: string, data: IntakeRow): IntakeSectionIssue[] {
  return getStepIssues(stepId, data).filter((issue) => issue.severity === 'error')
}

function isStepComplete(stepId: string, data: IntakeRow): boolean {
  return getStepErrors(stepId, data).length === 0
}

export function isSectionAccessible(step: IntakeStep, data: IntakeRow): boolean {
  // All sections are accessible once the prior section is at least started.
  // For v1 we keep it simple and allow access to any active section the user
  // has already reached or that follows a completed section.
  const active = getActiveSteps(data)
  const idx = active.findIndex((s) => s.id === step.id)
  if (idx <= 0) return true
  // Allow if the previous section is complete OR if the user is already past it
  return active.slice(0, idx).every((s) => s.isComplete(data)) ||
    active.slice(0, idx + 1).some((s) => s.isComplete(data))
}

function text(data: IntakeRow, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

function recordText(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

function hasBoolean(data: IntakeRow, key: string): boolean {
  return typeof data[key] === 'boolean'
}

function streetAddress(data: IntakeRow): string {
  return text(data, 'street_address') || text(data, 'address_line1')
}

function spouseData(data: IntakeRow): Record<string, unknown> {
  const spouse = data._spouse
  return spouse && typeof spouse === 'object' && !Array.isArray(spouse)
    ? spouse as Record<string, unknown>
    : {}
}

function spouseText(data: IntakeRow, key: string): string {
  const local = recordText(spouseData(data), key)
  if (local) return local
  const columnKey = key === 'first_name' || key === 'last_name' || key === 'date_of_birth'
    ? `spouse_${key}`
    : key
  return text(data, columnKey)
}

function nestedRecord(data: IntakeRow, key: string): Record<string, unknown> {
  const value = data[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(data: IntakeRow, key: string): unknown[] {
  const direct = data[key]
  if (Array.isArray(direct)) return direct
  const financial = nestedRecord(data, 'financial_details')
  const nested = financial[key]
  return Array.isArray(nested) ? nested : []
}

function goalValues(data: IntakeRow): unknown[] {
  if (Array.isArray(data.planning_goals)) return data.planning_goals
  return Array.isArray(data.goals) ? data.goals : []
}

function planningObjectiveText(data: IntakeRow, key: string): string {
  return recordText(nestedRecord(data, 'planning_objectives'), key)
}

function fiduciaryEntries(data: IntakeRow): Record<string, unknown> {
  return nestedRecord(data, 'fiduciary_entries')
}

function getFiduciaryList(data: IntakeRow, key: string): Record<string, unknown>[] {
  const local = data[`_${key}`]
  if (Array.isArray(local)) return local.filter(isRecord)
  const stored = fiduciaryEntries(data)[key]
  return Array.isArray(stored) ? stored.filter(isRecord) : []
}

function hasNamedEntry(entries: Record<string, unknown>[]): boolean {
  return entries.some((entry) => recordText(entry, 'first_name') && recordText(entry, 'last_name'))
}

// Display-completion for the fiduciary-type steps. The per-role submission
// checks are intentionally `warning` severity (you can submit and "discuss
// later"), so an empty step has zero *errors* and would otherwise read as
// "complete" in the sidebar. For the checkmark to be honest we require every
// role in the step to have at least one named entry. This is decoupled from
// submission gating — see isReadyToReview, which stays errors-only.
function allFiduciariesNamed(data: IntakeRow, keys: string[]): boolean {
  return keys.every((key) => hasNamedEntry(getFiduciaryList(data, key)))
}

function requiredFiduciaryIssue(
  data: IntakeRow,
  key: string,
  message: string,
  severity: IntakeIssueSeverity = 'error',
): IntakeSectionIssue[] {
  if (hasNamedEntry(getFiduciaryList(data, key))) return []
  const sectionId =
    key.endsWith('_spouse') ? 'spouse_fiduciaries' :
    key === 'fid_guardian_client' ? 'guardian' :
    'fiduciaries'
  const sectionTitle = getStepById(sectionId)?.title ?? 'Fiduciaries'
  return [{ sectionId, sectionTitle, message, severity }]
}

function getChildren(data: IntakeRow): Record<string, unknown>[] {
  if (Array.isArray(data._children)) return data._children.filter(isRecord)
  const stored = fiduciaryEntries(data).children
  return Array.isArray(stored) ? stored.filter(isRecord) : []
}

function getAdditionalContacts(data: IntakeRow): Record<string, unknown>[] {
  if (Array.isArray(data._additional_contacts)) return data._additional_contacts.filter(isRecord)
  const stored = fiduciaryEntries(data).additional_contacts
  return Array.isArray(stored) ? stored.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
