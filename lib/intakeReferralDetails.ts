import type { IntakeRow } from '@/lib/intakeSections'

export const REFERRAL_DETAIL_KEYS = [
  'legal_insurance_plan',
  'legal_insurance_member_id',
  'referral_name',
] as const

type ReferralDetailKey = (typeof REFERRAL_DETAIL_KEYS)[number]

export function isReferralDetailKey(key: string): key is ReferralDetailKey {
  return REFERRAL_DETAIL_KEYS.includes(key as ReferralDetailKey)
}

export function packReferralDetailsIntoFamilyDetails(data: IntakeRow): Record<string, unknown> | undefined {
  const existing = record(data.family_details)
  const familyDetails = existing ? { ...existing } : {}
  const referral: Record<string, string> = {}

  const source = stringValue(data.referral_source)
  if (source) referral.source = source

  for (const key of REFERRAL_DETAIL_KEYS) {
    const value = stringValue(data[key])
    if (value) referral[key] = value
  }

  if (Object.keys(referral).length > 0) {
    familyDetails.referral = referral
  } else {
    delete familyDetails.referral
  }

  return Object.keys(familyDetails).length > 0 ? familyDetails : undefined
}

export function unpackReferralDetailsFromFamilyDetails(data: IntakeRow): IntakeRow {
  const familyDetails = record(data.family_details)
  const referral = record(familyDetails?.referral)
  if (!referral) return data

  const unpacked: IntakeRow = { ...data }
  const source = stringValue(referral.source)
  if (source && !stringValue(unpacked.referral_source)) {
    unpacked.referral_source = source
  }

  for (const key of REFERRAL_DETAIL_KEYS) {
    const value = stringValue(referral[key])
    if (value) unpacked[key] = value
  }

  return unpacked
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
