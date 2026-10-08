import { PLANNING_GOAL_OPTIONS } from './goals'
import { SUFFIX_OPTIONS } from './options'
import { LEGAL_INSURANCE_PLAN_OPTIONS, REFERRAL_SOURCE_OPTIONS } from './referral'
import {
  citizenshipDesignLabel, citizenshipStatusFromDesignLabel,
  citizenshipStatusToLegacyBoolean, normalizeCitizenshipStatus,
} from './citizenship'
import { trimString } from './normalize'
import type { BuilderFieldDef, SharedFieldDef, SharedFieldId } from './types'

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
/** Scalar intake definitions only: compound person collections belong to blocks. */
function scalar(
  id: string,
  label: string,
  control: SharedFieldDef['control'] = 'text',
  options?: SharedFieldDef['options'],
): SharedFieldDef {
  return {
    id, label, control, intakeKey: id,
    ...(options ? { options } : {}),
    ...(['text', 'textarea', 'select', 'date'].includes(control) ? { normalize: trimString } : {}),
  }
}

export const INTAKE_SCALAR_FIELD_DEFS = {
  client_first_name: { ...scalar('client_first_name', 'First Name'), intakeKey: 'first_name' },
  client_middle_name: { ...scalar('client_middle_name', 'Middle Name'), intakeKey: 'middle_name' },
  client_last_name: { ...scalar('client_last_name', 'Last Name'), intakeKey: 'last_name' },
  client_suffix: { ...scalar('client_suffix', 'Suffix', 'select', SUFFIX_OPTIONS), intakeKey: 'suffix' },
  client_prior_name: { ...scalar('client_prior_name', 'Prior Name (maiden/former)'), intakeKey: 'prior_name' },
  client_preferred_name: { ...scalar('client_preferred_name', 'Preferred Name'), intakeKey: 'preferred_name' },
  referral_source: scalar('referral_source', 'How did you hear about us?', 'select', REFERRAL_SOURCE_OPTIONS),
  referral_name: scalar('referral_name', 'Referral Name'),
  legal_insurance_plan: scalar('legal_insurance_plan', 'Legal Insurance Plan', 'select', LEGAL_INSURANCE_PLAN_OPTIONS),
  legal_insurance_member_id: scalar('legal_insurance_member_id', 'Legal Insurance Member ID'),
  has_children: scalar('has_children', 'Do you have children?', 'boolean'),
  has_minor_children: scalar('has_minor_children', 'Do you have children under 18?', 'boolean'),
  has_existing_plan: scalar('has_existing_plan', 'Do you have an existing estate plan?', 'boolean'),
  has_divorce_settlement: scalar('has_divorce_settlement', 'Do you have a divorce settlement?', 'boolean'),
  has_ltc_insurance: scalar('has_ltc_insurance', 'Do you have long-term care insurance?', 'boolean'),
  has_prior_gift_tax: scalar('has_prior_gift_tax', 'Have you filed a gift tax return?', 'boolean'),
  college_school_name: scalar('college_school_name', 'School / program'),
  college_move_in_date: scalar('college_move_in_date', 'Move-in / orientation date', 'date'),
  college_school_city: scalar('college_school_city', 'School city'),
  college_school_state: scalar('college_school_state', 'School state'),
  college_studying_abroad: scalar('college_studying_abroad', 'Studying abroad', 'boolean'),
  college_abroad_country: scalar('college_abroad_country', 'Country'),
  college_ferpa_release: scalar('college_ferpa_release', 'Authorize a FERPA release', 'boolean'),
  college_ferpa_records: scalar('college_ferpa_records', 'FERPA records', 'multiselect', COLLEGE_FERPA_RECORD_OPTIONS),
  college_ferpa_recipients: scalar('college_ferpa_recipients', 'FERPA recipients', 'textarea'),
  college_family_circumstances: scalar('college_family_circumstances', 'Family circumstances', 'textarea'),
  college_dpoa_effective: scalar('college_dpoa_effective', 'When should the power of attorney take effect?', 'select', COLLEGE_DPOA_EFFECTIVE_OPTIONS),
  college_dpoa_powers: scalar('college_dpoa_powers', 'Powers granted', 'multiselect', COLLEGE_DPOA_POWER_OPTIONS),
  college_dpoa_withheld: scalar('college_dpoa_withheld', 'Powers withheld or limited', 'textarea'),
  college_dpoa_notes: scalar('college_dpoa_notes', 'Power of attorney notes', 'textarea'),
  college_hcp_limits: scalar('college_hcp_limits', "Limits on the health care agent's authority", 'textarea'),
  college_hcp_instructions: scalar('college_hcp_instructions', 'Religious, cultural, or personal instructions', 'textarea'),
  college_hipaa_scope: scalar('college_hipaa_scope', 'Health information released', 'select', COLLEGE_HIPAA_SCOPE_OPTIONS),
  college_hipaa_different_scope: scalar('college_hipaa_different_scope', 'Different scope for different people', 'textarea'),
  college_hipaa_excluded_categories: scalar('college_hipaa_excluded_categories', 'Excluded health information', 'multiselect', COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS),
  college_hipaa_expiration: scalar('college_hipaa_expiration', 'HIPAA authorization expiration', 'select', COLLEGE_HIPAA_EXPIRATION_OPTIONS),
  college_hipaa_expiration_date: scalar('college_hipaa_expiration_date', 'HIPAA expiration date', 'date'),
  college_living_will_include: scalar('college_living_will_include', 'Include a living will', 'select', COLLEGE_LIVING_WILL_INCLUDE_OPTIONS),
  college_life_support: scalar('college_life_support', 'Life support preferences', 'select', COLLEGE_LIFE_SUPPORT_OPTIONS),
  college_artificial_nutrition: scalar('college_artificial_nutrition', 'Artificial nutrition and hydration', 'select', COLLEGE_TREATMENT_CHOICE_OPTIONS),
  college_ventilation: scalar('college_ventilation', 'Mechanical ventilation', 'select', COLLEGE_TREATMENT_CHOICE_OPTIONS),
  college_cpr: scalar('college_cpr', 'CPR', 'select', COLLEGE_TREATMENT_CHOICE_OPTIONS),
  college_comfort_always: scalar('college_comfort_always', 'Comfort care at all times', 'boolean'),
  college_organ_donation: scalar('college_organ_donation', 'Organ donation', 'select', COLLEGE_ORGAN_DONATION_OPTIONS),
  college_organ_donation_notes: scalar('college_organ_donation_notes', 'Organ donation notes', 'textarea'),
  college_other_medical_notes: scalar('college_other_medical_notes', 'Other medical notes', 'textarea'),
  college_excluded_people: scalar('college_excluded_people', 'People who should not receive access', 'textarea'),
  college_concerns: scalar('college_concerns', 'College preparation concerns', 'textarea'),
} satisfies Record<string, SharedFieldDef>

export type IntakeCatalogFieldId = keyof typeof INTAKE_SCALAR_FIELD_DEFS

export const BUILDER_FIELD_IDS: readonly SharedFieldId[] = [
  'client_pronouns', 'client_dob', 'client_citizenship', 'client_email', 'client_phone',
  'street', 'city', 'state', 'zip', 'county', 'marital_status', 'marriage_date',
  'estate_value', 'asset_types', 'planning_goals', 'special_notes',
  ...Object.keys(INTAKE_SCALAR_FIELD_DEFS) as IntakeCatalogFieldId[],
]

/** Only this code decides where an answer is read or written. */
export function createBuilderField(def: SharedFieldDef): BuilderFieldDef {
  const key = def.intakeKey
  if (!key) throw new Error(`Builder field ${def.id} has no intake adapter`)
  const validationProfile = def.control === 'date' ? 'date'
    : def.control === 'email' ? 'email'
    : def.control === 'tel' ? 'phone'
    : def.id === 'county' ? 'ma_county' : 'none'
  const baselineRequirement = def.id === 'client_first_name' || def.id === 'client_last_name' ? 'required'
    : ['client_dob', 'client_email', 'client_phone', 'county'].includes(def.id) ? 'recommended' : 'optional'
  const builder: BuilderFieldDef = {
    ...def, builderEnabled: true, baselineRequirement, validationProfile,
    // Goal options were missing from the shared display definition; retain its
    // normalizer and mappings while supplying the existing intake vocabulary.
    ...(def.id === 'planning_goals' ? { options: PLANNING_GOAL_OPTIONS } : {}),
    read: (data) => {
      if (Object.hasOwn(data, key)) return data[key]
      if (key.startsWith('college_')) {
        const details = data.college_prep_details
        if (details && typeof details === 'object' && !Array.isArray(details)) {
          return (details as Record<string, unknown>)[key.slice('college_'.length)]
        }
      }
      return def.id === 'planning_goals' ? data.goals : undefined
    },
    write: (value, update) => update(key, value),
  }
  if (def.id === 'client_citizenship') {
    // The newer status vocabulary accepts Other; keep a stored answer visible
    // without changing the original shared options or legacy metadata.
    builder.legacyValues = [...(def.legacyValues ?? []), 'Other']
    builder.read = (data) => citizenshipDesignLabel(normalizeCitizenshipStatus(
      data.citizenship_status, typeof data.is_us_citizen === 'boolean' ? data.is_us_citizen : null,
    ))
    builder.write = (value, update) => {
      const status = citizenshipStatusFromDesignLabel(value)
      update('citizenship_status', status)
      update('is_us_citizen', citizenshipStatusToLegacyBoolean(status))
    }
  }
  return builder
}
