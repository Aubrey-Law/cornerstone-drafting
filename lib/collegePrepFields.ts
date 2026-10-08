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

// The package owns scalar choice vocabularies; existing app imports remain valid.
export {
  DISCUSS_AT_MEETING,
  COLLEGE_FERPA_RECORD_OPTIONS,
  COLLEGE_DPOA_EFFECTIVE_OPTIONS,
  COLLEGE_DPOA_POWER_OPTIONS,
  COLLEGE_HIPAA_SCOPE_OPTIONS,
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
  COLLEGE_HIPAA_EXPIRATION_OPTIONS,
  COLLEGE_LIVING_WILL_INCLUDE_OPTIONS,
  COLLEGE_LIFE_SUPPORT_OPTIONS,
  COLLEGE_TREATMENT_CHOICE_OPTIONS,
  COLLEGE_ORGAN_DONATION_OPTIONS,
} from '@aubrey-law/estate-fields/core'

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
