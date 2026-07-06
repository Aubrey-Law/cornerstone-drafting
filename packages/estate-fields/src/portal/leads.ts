import type { FieldOption } from '../core/types'
import { ESTATE_VALUE_OPTIONS, estateValueLabel, estateValueMidpoint } from '../core/assets'
import { MARITAL_STATUS_OPTIONS } from '../core/options'

/** Public lead intake form — why they're reaching out. */
export const LEAD_INTAKE_REASON_OPTIONS = [
  { value: 'no_plan', label: "I don't have an estate plan yet" },
  { value: 'update', label: 'I need to update an existing plan' },
  { value: 'life_change', label: 'I recently had a major life change' },
  { value: 'specific_concern', label: "I have a specific concern I'd like to discuss" },
] as const satisfies readonly FieldOption[]

/** Public lead intake — how they found the firm. */
export const LEAD_SOURCE_OPTIONS = [
  { value: 'google', label: 'Google search' },
  { value: 'referral_personal', label: 'Referral from friend or family' },
  { value: 'referral_professional', label: 'Referral from professional (attorney, FA, accountant)' },
  { value: 'legal_plan', label: 'Legal plan (MetLife, ARAG, LegalEase, etc.)' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly FieldOption[]

/** Discovery call — legal plan membership (distinct from intake legal insurance pills). */
export const LEAD_LEGAL_PLAN_OPTIONS: FieldOption[] = [
  { value: 'none', label: 'None' },
  { value: 'metlife', label: 'MetLife' },
  { value: 'legalease', label: 'LegalEASE' },
  { value: 'arag', label: 'ARAG' },
  { value: 'other', label: 'Other' },
]

/** Lead + intake marital status (includes discovery-only values). */
export const LEAD_MARITAL_STATUS_OPTIONS: FieldOption[] = [...MARITAL_STATUS_OPTIONS]

/** Canonical estate value ranges — shared with client intake wizard. */
export { ESTATE_VALUE_OPTIONS, estateValueLabel, estateValueMidpoint }

/** Map lead/discovery marital status into intake storage vocabulary. */
export function normalizeLeadMaritalStatusForIntake(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!text) return null
  const match = MARITAL_STATUS_OPTIONS.find((o) => o.value === text)
  return match?.value ?? null
}
