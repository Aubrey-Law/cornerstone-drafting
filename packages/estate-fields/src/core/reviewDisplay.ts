import {
  assetTypeLabel,
  estateValueLabel,
  formatAssetTypesForReview,
  INTAKE_FINANCIAL_DETAIL_LABELS,
} from './assets'
import { formatPlanningGoalsForDesign } from './goals'
import { referralSourceLabel } from './referral'
import { getFiduciaryIntakeSlot } from './fiduciaries'
import { MARITAL_STATUS_OPTIONS, PRONOUN_OPTIONS } from './options'
import { formatPhoneDisplay } from './phone'
import { normalizeMaritalStatus, trimString } from './normalize'

/** Keys used by IntakeQuestionnaireReview — labels + formatters live here. */
export type IntakeReviewFieldKey =
  | 'referral_source'
  | 'referral_name'
  | 'legal_insurance_plan'
  | 'legal_insurance_member_id'
  | 'client_name'
  | 'preferred_name'
  | 'date_of_birth'
  | 'email'
  | 'phone'
  | 'address'
  | 'county'
  | 'is_us_citizen'
  | 'marital_status'
  | 'has_children'
  | 'has_minor_children'
  | 'spouse_name'
  | 'spouse_dob'
  | 'spouse_email'
  | 'spouse_phone'
  | 'estate_value'
  | 'asset_types'
  | 'why_choose_firm'
  | 'why_now'
  | 'make_things_easy'
  | 'planning_goals'
  | 'has_existing_plan'
  | 'has_divorce_settlement'
  | 'has_prior_gift_tax'
  | 'special_notes'
  | 'planning_objectives'

const REVIEW_LABELS: Record<IntakeReviewFieldKey, string> = {
  referral_source: 'How you found us',
  referral_name: 'Referral name',
  legal_insurance_plan: 'Legal insurance plan',
  legal_insurance_member_id: 'Member ID',
  client_name: 'Name',
  preferred_name: 'Preferred name',
  date_of_birth: 'Date of birth',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  county: 'County',
  is_us_citizen: 'U.S. citizen',
  marital_status: 'Marital status',
  has_children: 'Has children',
  has_minor_children: 'Has minor children',
  spouse_name: 'Name',
  spouse_dob: 'Date of birth',
  spouse_email: 'Email',
  spouse_phone: 'Phone',
  estate_value: 'Estimated value',
  asset_types: 'Asset types',
  why_choose_firm: 'Why Aubrey Law',
  why_now: 'Why planning now',
  make_things_easy: 'Making things easy',
  planning_goals: 'Planning goals',
  has_existing_plan: 'Existing plan on file',
  has_divorce_settlement: 'Divorce settlement payments',
  has_prior_gift_tax: 'Gift tax returns',
  special_notes: 'Additional notes',
  planning_objectives: 'Planning objectives',
}

export function intakeReviewLabel(key: IntakeReviewFieldKey): string {
  return REVIEW_LABELS[key]
}

export function isIntakeReviewFieldKey(key: string): key is IntakeReviewFieldKey {
  return key in REVIEW_LABELS
}

function maritalStatusLabel(raw: unknown): string {
  const normalized = normalizeMaritalStatus(raw)
  if (!normalized) return ''
  return MARITAL_STATUS_OPTIONS.find((o) => o.value === normalized)?.label ?? normalized
}

function pronounLabel(raw: unknown): string {
  const value = trimString(raw)
  if (!value) return ''
  return PRONOUN_OPTIONS.find((o) => o.value === value)?.label ?? value
}

function booleanReview(raw: unknown): string {
  if (typeof raw !== 'boolean') return ''
  return raw ? 'Yes' : 'No'
}

function textReview(raw: unknown): string {
  return trimString(raw) ?? ''
}

/** Format a single intake review field for display. */
export function formatIntakeReviewValue(key: IntakeReviewFieldKey, value: unknown): string {
  switch (key) {
    case 'referral_source':
      return referralSourceLabel(value)
    case 'marital_status':
      return maritalStatusLabel(value)
    case 'is_us_citizen':
      return booleanReview(value)
    case 'estate_value':
      return estateValueLabel(value)
    case 'asset_types':
      return formatAssetTypesForReview(value)
    case 'planning_goals':
      return formatPlanningGoalsForDesign(value) ?? formatAssetTypesForReview(value)
    case 'has_children':
    case 'has_minor_children':
    case 'has_existing_plan':
    case 'has_divorce_settlement':
    case 'has_prior_gift_tax':
      return booleanReview(value)
    case 'phone':
    case 'spouse_phone': {
      const formatted = formatPhoneDisplay(typeof value === 'string' ? value : null)
      return formatted || textReview(value)
    }
    default:
      return textReview(value)
  }
}

/** `[label, displayText]` row for questionnaire review sections; null when empty. */
export function intakeReviewRow(
  key: IntakeReviewFieldKey,
  value: unknown,
): [string, string] | null {
  const text = formatIntakeReviewValue(key, value)
  if (!text) return null
  return [intakeReviewLabel(key), text]
}

/** Resolve fiduciary section title from wizard local key (`_fid_trustee_client`, etc.). */
export function fiduciaryReviewTitle(intakeLocalKey: string): string {
  const intakeKey = intakeLocalKey.startsWith('_')
    ? intakeLocalKey.slice(1)
    : intakeLocalKey
  const slot = getFiduciaryIntakeSlot(intakeKey)
  if (slot) return slot.label
  if (intakeKey === 'fid_excluded_guardian') return 'Excluded as guardian'
  return intakeLocalKey.replace(/^_fid_/, '').replace(/_/g, ' ')
}

/** Label for intake financial-detail summary rows. */
export function financialDetailReviewLabel(key: string): string {
  return INTAKE_FINANCIAL_DETAIL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export { assetTypeLabel, estateValueLabel, formatAssetTypesForReview, pronounLabel, maritalStatusLabel, booleanReview }
