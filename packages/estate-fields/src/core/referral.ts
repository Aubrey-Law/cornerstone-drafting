import type { FieldOption } from './types'

/** Client intake referral step — pill/select vocabulary. */
export const REFERRAL_SOURCE_OPTIONS: FieldOption[] = [
  { value: 'Referral', label: 'Referral' },
  { value: 'Legal Insurance', label: 'Legal Insurance' },
  { value: 'Other', label: 'Other' },
]

export const LEGAL_INSURANCE_PLAN_OPTIONS: FieldOption[] = [
  { value: 'MetLife', label: 'MetLife' },
  { value: 'LegalEase', label: 'LegalEase' },
  { value: 'ARAG', label: 'ARAG' },
  { value: 'CLC', label: 'CLC' },
]

export const REFERRAL_SOURCE_VALUES = REFERRAL_SOURCE_OPTIONS.map((o) => o.value)

export function referralSourceLabel(raw: unknown): string {
  if (raw == null || raw === '') return ''
  const value = String(raw).trim()
  return REFERRAL_SOURCE_OPTIONS.find((o) => o.value === value)?.label ?? value
}
