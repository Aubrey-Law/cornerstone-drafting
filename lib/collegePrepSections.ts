import { validateIntakeField } from '@/lib/sharedFields/intakeValidate'
import { fractionalAgeFromDob } from '@/lib/youngAdultEstatePlan'
import {
  COLLEGE_PREP_FIELD_PREFIX,
  DISCUSS_AT_MEETING,
  collegePrepDetailKey,
  namedHipaaRecipients,
} from '@/lib/collegePrepFields'
import type {
  IntakeIssueSeverity,
  IntakeRow,
  IntakeSectionIssue,
  IntakeStep,
} from '@/lib/intakeSections'

/**
 * The College Preparation Plan question set.
 *
 * Modeled on the firm's "College Preparation Plan — Client Intake Form", with
 * the gaps in that draft filled in: the living-will section (which the Word
 * form headed but never asked), a FERPA release for education records (which
 * it omits entirely), and the HIPAA expiration the authorization is required
 * to state.
 *
 * Step ids are `cp_`-prefixed so they never collide with the estate track's
 * ids — `getStepById` searches one flat registry across both tracks.
 */
export const COLLEGE_PREP_STEPS: IntakeStep[] = [
  {
    id: 'cp_student',
    title: 'Student Information',
    subtitle: 'The student is the client — every document is signed by them',
    timeEstimate: 3,
    isComplete: (r) => isStepComplete('cp_student', r),
  },
  {
    id: 'cp_school',
    title: 'School Information',
    subtitle: 'Where the student is headed, and school records access',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('cp_school', r),
  },
  {
    id: 'cp_parents',
    title: 'Parents & Guardians',
    subtitle: 'Who may be named, and anything we should know',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('cp_parents', r),
  },
  {
    id: 'cp_agents',
    title: 'Agent Designations',
    subtitle: 'Financial agent, health care agent, and who may receive information',
    timeEstimate: 4,
    isComplete: (r) =>
      (hasNamedFiduciary(r, 'fid_poa_client') && hasNamedFiduciary(r, 'fid_hcp_client')) ||
      hasReviewChoice(r, 'cp_agents'),
  },
  {
    id: 'cp_dpoa',
    title: 'Power of Attorney — Scope',
    subtitle: 'When it takes effect and what it covers',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('cp_dpoa', r),
  },
  {
    id: 'cp_healthcare',
    title: 'Health Care Proxy',
    subtitle: 'Limits and personal instructions (optional)',
    timeEstimate: 1,
    optional: true,
    isComplete: (r) =>
      !!text(r, 'college_hcp_limits') || !!text(r, 'college_hcp_instructions'),
  },
  {
    id: 'cp_hipaa',
    title: 'HIPAA Authorization',
    subtitle: 'What may be shared, and for how long',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('cp_hipaa', r),
  },
  {
    id: 'cp_living_will',
    title: 'Living Will',
    subtitle: 'Written instructions about care',
    timeEstimate: 2,
    isComplete: (r) => isStepComplete('cp_living_will', r),
  },
  {
    id: 'cp_other',
    title: 'Other Matters',
    subtitle: 'Anything else we should know (optional)',
    timeEstimate: 1,
    optional: true,
    isComplete: (r) => !!text(r, 'college_concerns'),
  },
  {
    id: 'review',
    title: 'Review & Submit',
    subtitle: 'Confirm & submit',
    timeEstimate: 1,
    isComplete: (r) => r.status === 'submitted' || r.status === 'approved',
  },
]

/**
 * Track-owned steps only. `review` is deliberately excluded: both tracks share
 * that id and neither raises issues from it, so routing it here would be a
 * coin flip that happens to work.
 */
export function isCollegePrepStepId(stepId: string): boolean {
  return stepId.startsWith('cp_')
}

export function getCollegePrepStepIssues(stepId: string, data: IntakeRow): IntakeSectionIssue[] {
  const step = COLLEGE_PREP_STEPS.find((s) => s.id === stepId)
  if (!step) return []

  const issue = (
    message: string,
    severity: IntakeIssueSeverity = 'error',
  ): IntakeSectionIssue => ({
    sectionId: step.id,
    sectionTitle: step.title,
    message,
    severity,
  })
  // Only contact information blocks submission (see IntakeSectionIssue).
  const contactIssue = (message: string): IntakeSectionIssue => ({
    ...issue(message),
    blocksSubmission: true,
  })

  switch (stepId) {
    case 'cp_student': {
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'first_name')) issues.push(contactIssue("Enter the student's first name."))
      if (!text(data, 'last_name')) issues.push(contactIssue("Enter the student's last name."))
      const email = text(data, 'email')
      if (!email) issues.push(contactIssue("Enter the student's email address."))
      else {
        const emailError = validateIntakeField('email', email)
        if (emailError) issues.push(contactIssue(emailError))
      }
      if (!text(data, 'phone')) issues.push(contactIssue("Enter the student's cell phone number."))
      if (!streetAddress(data)) issues.push(issue("Enter the student's permanent street address."))
      if (!text(data, 'city')) issues.push(issue('Enter the city.'))
      if (!text(data, 'state')) issues.push(issue('Enter the state.'))
      if (!text(data, 'zip')) issues.push(issue('Enter the ZIP code.'))

      const dob = text(data, 'date_of_birth')
      if (!dob) {
        issues.push(issue("Enter the student's date of birth."))
      } else {
        const age = fractionalAgeFromDob(dob)
        // Not a blocker: families routinely start this the summer before the
        // birthday. It has to reach the attorney, though — a minor cannot
        // execute any document in this package.
        if (age !== null && age < 18) {
          issues.push(issue(
            'The student is under 18. These documents can only be signed on or after their eighteenth birthday — we will schedule around it.',
            'warning',
          ))
        }
      }

      if (!text(data, 'county')) {
        issues.push(issue('Select the Massachusetts county of the permanent address.'))
      } else {
        const countyError = validateIntakeField('county', data.county)
        if (countyError) issues.push(issue(countyError))
      }
      return issues
    }

    case 'cp_school': {
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'college_school_name')) {
        issues.push(issue('Enter the college, university, or program.'))
      }
      if (!text(data, 'college_school_city') || !text(data, 'college_school_state')) {
        issues.push(issue(
          'Enter the campus city and state — an out-of-state campus changes which forms providers there will accept.',
          'warning',
        ))
      }
      if (!text(data, 'college_move_in_date')) {
        issues.push(issue(
          'Enter the move-in or orientation date if you know it, so we can work back from that deadline.',
          'warning',
        ))
      }
      const ferpaRelease = boolValue(data, 'college_ferpa_release')
      if (ferpaRelease === null) {
        issues.push(issue('Answer whether the student wants a FERPA release for school records.'))
      } else if (ferpaRelease && arrayValue(data, 'college_ferpa_records').length === 0) {
        issues.push(issue('Select which school records the FERPA release should cover.'))
      }
      return issues
    }

    case 'cp_parents': {
      const parents = namedParentContacts(data)
      if (parents.length === 0) {
        return [issue('Add at least one parent or guardian.')]
      }
      const issues: IntakeSectionIssue[] = []
      parents.forEach((parent, index) => {
        if (!recordText(parent, 'phone') && !recordText(parent, 'email')) {
          issues.push(issue(
            `Add a phone number or email for ${recordText(parent, 'first_name') || `parent/guardian ${index + 1}`} — an agent we cannot reach is not much use in an emergency.`,
            'warning',
          ))
        }
      })
      return issues
    }

    case 'cp_agents': {
      if (hasReviewChoice(data, 'cp_agents')) return []
      const issues: IntakeSectionIssue[] = []
      if (!hasNamedFiduciary(data, 'fid_poa_client')) {
        issues.push(issue(
          'Name a financial agent under the durable power of attorney, or mark this to discuss at the meeting.',
          'warning',
        ))
      }
      if (!hasNamedFiduciary(data, 'fid_hcp_client')) {
        issues.push(issue(
          'Name a health care agent, or mark this to discuss at the meeting. Massachusetts allows only one agent at a time — name one agent and one alternate, not co-agents.',
          'warning',
        ))
      }
      if (namedHipaaRecipients(value(data, 'college_hipaa_recipients')).length === 0) {
        issues.push(issue(
          'List everyone a provider should be allowed to talk to. This grants no decision-making power, so most families name more people here than hold the proxy.',
          'warning',
        ))
      }
      return issues
    }

    case 'cp_dpoa': {
      const issues: IntakeSectionIssue[] = []
      const effective = text(data, 'college_dpoa_effective')
      if (!effective) {
        issues.push(issue('Choose when the power of attorney takes effect.'))
      }
      if (
        effective &&
        effective !== DISCUSS_AT_MEETING &&
        arrayValue(data, 'college_dpoa_powers').length === 0
      ) {
        issues.push(issue(
          'Select the powers to grant, or choose “Discuss at the meeting” above.',
          'warning',
        ))
      }
      return issues
    }

    case 'cp_healthcare':
      return []

    case 'cp_hipaa': {
      const issues: IntakeSectionIssue[] = []
      const scope = text(data, 'college_hipaa_scope')
      if (!scope) {
        issues.push(issue('Choose what health information may be released.'))
      }
      if (scope === 'all_except' && arrayValue(data, 'college_hipaa_excluded_categories').length === 0) {
        issues.push(issue('Select at least one category to withhold, or choose “All health information”.'))
      }
      const expiration = text(data, 'college_hipaa_expiration')
      if (!expiration) {
        // HIPAA requires the authorization itself to state an expiration date
        // or event, so this cannot be deferred to drafting.
        issues.push(issue('Choose when the HIPAA authorization expires.'))
      }
      if (expiration === 'date' && !text(data, 'college_hipaa_expiration_date')) {
        issues.push(issue('Enter the date the HIPAA authorization should expire.'))
      }
      return issues
    }

    case 'cp_living_will': {
      const include = text(data, 'college_living_will_include')
      if (!include) {
        return [issue('Choose whether to include a living will.')]
      }
      if (include !== 'yes') return []
      const issues: IntakeSectionIssue[] = []
      if (!text(data, 'college_life_support')) {
        issues.push(issue('Choose the student’s instruction about life-sustaining treatment.'))
      }
      if (!text(data, 'college_organ_donation')) {
        issues.push(issue('Answer the organ donation question, or mark it to discuss.', 'warning'))
      }
      return issues
    }

    case 'cp_other':
      return []

    default:
      return []
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isStepComplete(stepId: string, data: IntakeRow): boolean {
  return getCollegePrepStepIssues(stepId, data).every((i) => i.severity !== 'error')
}

/**
 * Read a field that may be either flat (`college_x`, how the wizard holds it)
 * or nested (`college_prep_details.x`, how the row stores it). Submission
 * validation runs server-side against the stored row, which never went through
 * `unpackInitialIntakeData` — the estate track solves the same problem the same
 * way for `financial_details`.
 */
function value(data: IntakeRow, key: string): unknown {
  const direct = data[key]
  if (direct !== undefined) return direct
  if (!key.startsWith(COLLEGE_PREP_FIELD_PREFIX)) return undefined
  return nestedRecord(data, 'college_prep_details')[collegePrepDetailKey(key)]
}

function text(data: IntakeRow, key: string): string {
  const raw = value(data, key)
  return typeof raw === 'string' ? raw.trim() : ''
}

function recordText(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? (data[key] as string).trim() : ''
}

function boolValue(data: IntakeRow, key: string): boolean | null {
  const raw = value(data, key)
  return typeof raw === 'boolean' ? raw : null
}

function streetAddress(data: IntakeRow): string {
  return text(data, 'street_address') || text(data, 'address_line1')
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
}

function nestedRecord(data: IntakeRow, key: string): Record<string, unknown> {
  return isRecord(data[key]) ? (data[key] as Record<string, unknown>) : {}
}

function arrayValue(data: IntakeRow, key: string): unknown[] {
  const raw = value(data, key)
  return Array.isArray(raw) ? raw : []
}

/**
 * Parents and guardians ride the existing additional-contacts pipeline so they
 * land in `contacts` and show up in the agent pickers.
 */
function namedParentContacts(data: IntakeRow): Record<string, unknown>[] {
  const local = data._additional_contacts
  const entries = Array.isArray(local)
    ? local
    : Array.isArray(nestedRecord(data, 'fiduciary_entries').additional_contacts)
      ? (nestedRecord(data, 'fiduciary_entries').additional_contacts as unknown[])
      : []
  return entries
    .filter(isRecord)
    .filter((entry) => recordText(entry, 'first_name') && recordText(entry, 'last_name'))
}

function fiduciaryList(data: IntakeRow, key: string): Record<string, unknown>[] {
  const local = data[`_${key}`]
  if (Array.isArray(local)) return local.filter(isRecord)
  const stored = nestedRecord(data, 'fiduciary_entries')[key]
  return Array.isArray(stored) ? stored.filter(isRecord) : []
}

function hasNamedFiduciary(data: IntakeRow, key: string): boolean {
  return fiduciaryList(data, key).some(
    (entry) => recordText(entry, 'first_name') && recordText(entry, 'last_name'),
  )
}

function hasReviewChoice(data: IntakeRow, key: string): boolean {
  const local = recordText(nestedRecord(data, '_review_choices'), key)
  const choice = local || recordText(nestedRecord(data, 'review_choices'), key)
  return choice === 'discuss_with_attorney' || choice === 'not_provided_yet'
}
