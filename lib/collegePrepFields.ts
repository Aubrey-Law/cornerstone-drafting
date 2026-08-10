/**
 * College Preparation Plan answer fields.
 *
 * These live in the wizard state as `college_*` keys and are packed into the
 * single `client_intake.college_prep_details` JSONB column (prefix stripped),
 * the same way `financial_*` keys pack into `financial_details`. The student's
 * own identity — name, DOB, address, phone, email, citizenship — is *not*
 * here: the student is the client, so those reuse the core `client_intake`
 * columns and flow into the design sheet unchanged.
 *
 * Parents/guardians are not here either. They are stored as
 * `_additional_contacts` so they land in `contacts`, become searchable in the
 * agent pickers, and survive into the design sheet like any other nominee.
 */

export const COLLEGE_PREP_FIELD_PREFIX = 'college_'

/** Options for a question the client may defer to the drafting meeting. */
export const DISCUSS_AT_MEETING = 'discuss'

// ── Section: School ──────────────────────────────────────────────────────────

export const COLLEGE_FERPA_RECORD_OPTIONS = [
  { value: 'grades', label: 'Grades and transcripts' },
  { value: 'billing', label: 'Bursar / tuition account' },
  { value: 'financial_aid', label: 'Financial aid records' },
  { value: 'housing', label: 'Housing and residence life' },
  { value: 'conduct', label: 'Student conduct and disciplinary records' },
  { value: 'health_center', label: 'Campus health / counseling center' },
] as const

// ── Section: Durable Power of Attorney ───────────────────────────────────────

export const COLLEGE_DPOA_EFFECTIVE_OPTIONS = [
  {
    value: 'immediately',
    label: 'Immediately upon signing',
    sub: 'Recommended — institutions act without demanding proof of incapacity.',
  },
  {
    value: 'springing',
    label: 'Only upon a documented determination of incapacity',
    sub: '“Springing” — the agent must produce a physician’s determination first.',
  },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting', sub: '' },
] as const

/** Section E-2 of the firm's intake form, in the same order. */
export const COLLEGE_DPOA_POWER_OPTIONS = [
  { value: 'banking', label: 'Banking and bank accounts' },
  { value: 'bills', label: 'Paying bills and routine expenses' },
  { value: 'tuition', label: 'Tuition, bursar, and student accounts' },
  { value: 'financial_aid', label: 'Financial aid office and scholarships' },
  { value: 'student_loans', label: 'Student loans and loan servicers' },
  { value: 'credit_cards', label: 'Credit cards and consumer debt' },
  { value: 'taxes', label: 'Tax filings and communication with the IRS / DOR' },
  { value: 'housing', label: 'Leases, housing, and security deposits' },
  { value: 'auto', label: 'Auto — registration, insurance, repairs' },
  { value: 'insurance_claims', label: 'Insurance claims of any kind' },
  { value: 'retain_attorney', label: 'Retaining and instructing an attorney' },
  { value: 'citations', label: 'Responding to citations, summonses, or conduct charges' },
  { value: 'investments', label: 'Investment and brokerage accounts' },
  { value: 'digital', label: 'Digital accounts and online access' },
  { value: 'employment', label: 'Employment paperwork and payroll' },
  { value: 'contracts', label: "Signing contracts on the student's behalf" },
] as const

// ── Section: HIPAA ───────────────────────────────────────────────────────────

export const COLLEGE_HIPAA_SCOPE_OPTIONS = [
  { value: 'all', label: 'All health information, without limitation' },
  { value: 'all_except', label: 'All health information EXCEPT the categories below' },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting' },
] as const

/** Categories that carry heightened protection and are worth carving out by name. */
export const COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS = [
  { value: 'mental_health', label: 'Mental health / psychotherapy notes' },
  { value: 'substance_use', label: 'Substance use treatment' },
  { value: 'hiv', label: 'HIV / AIDS status and testing' },
  { value: 'reproductive', label: 'Reproductive and sexual health' },
  { value: 'genetic', label: 'Genetic testing and results' },
] as const

export const COLLEGE_HIPAA_EXPIRATION_OPTIONS = [
  { value: 'none', label: 'No expiration — until the student revokes it' },
  { value: 'date', label: 'Expires on a specific date' },
] as const

// ── Section: Living will / advance directive ─────────────────────────────────

export const COLLEGE_LIVING_WILL_INCLUDE_OPTIONS = [
  { value: 'yes', label: 'Yes — include written treatment instructions' },
  { value: 'no', label: 'No — leave every decision to the health care agent' },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting' },
] as const

export const COLLEGE_LIFE_SUPPORT_OPTIONS = [
  {
    value: 'all_measures',
    label: 'Use all available measures to prolong life',
    sub: 'Continue life-sustaining treatment regardless of prognosis.',
  },
  {
    value: 'comfort_only',
    label: 'Comfort care only if there is no reasonable hope of recovery',
    sub: 'Withhold or withdraw life-sustaining treatment; keep me comfortable.',
  },
  {
    value: 'trust_agent',
    label: 'Leave it to my health care agent',
    sub: 'No written instruction — the agent decides in the moment.',
  },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting', sub: '' },
] as const

export const COLLEGE_TREATMENT_CHOICE_OPTIONS = [
  { value: 'yes', label: 'Yes, I would want it' },
  { value: 'no', label: 'No, I would not want it' },
  { value: 'agent_decides', label: 'My agent decides' },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting' },
] as const

export const COLLEGE_ORGAN_DONATION_OPTIONS = [
  { value: 'any', label: 'Yes — any needed organs or tissue' },
  { value: 'specific', label: 'Yes — only the organs or purposes I name below' },
  { value: 'no', label: 'No' },
  { value: DISCUSS_AT_MEETING, label: 'Discuss at the meeting' },
] as const

// ── Repeating entries ────────────────────────────────────────────────────────

/** A person a provider may talk to under the HIPAA authorization. */
export interface CollegeHipaaRecipient {
  id: string
  name: string
  relationship: string
  phone: string
  email: string
  [key: string]: unknown
}

export function emptyHipaaRecipient(id: string): CollegeHipaaRecipient {
  return { id, name: '', relationship: '', phone: '', email: '' }
}

export function namedHipaaRecipients(value: unknown): CollegeHipaaRecipient[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is CollegeHipaaRecipient =>
      !!entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as { name?: unknown }).name === 'string' &&
      (entry as { name: string }).name.trim().length > 0,
  )
}

// ── Packing ──────────────────────────────────────────────────────────────────

export function isCollegePrepFieldKey(key: string): boolean {
  return key.startsWith(COLLEGE_PREP_FIELD_PREFIX)
}

/** Wizard `college_x` key → the key stored inside `college_prep_details`. */
export function collegePrepDetailKey(key: string): string {
  return key.slice(COLLEGE_PREP_FIELD_PREFIX.length)
}

/** Stored `college_prep_details` key → the wizard field key. */
export function collegePrepFieldKey(detailKey: string): string {
  return `${COLLEGE_PREP_FIELD_PREFIX}${detailKey}`
}
