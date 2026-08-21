import type { MetlifeServiceType } from '@/lib/metlife/types'

/**
 * MetLife's fee schedule, in integer cents. The ledger stores cents
 * (`billing_items.amount_billed`) and a claim is a sum of many small fees, so
 * cents everywhere keeps section totals exact. Formatting happens at render.
 *
 * `couple` is the rate when one document covers both member and spouse. A
 * document billed once per person always uses `member`.
 */
export const METLIFE_FEES = {
  will: { member: 15_000, couple: 18_500 },
  trust: { member: 32_500, couple: 40_000 },
  advancedMedicalDirective: { member: 4_500, couple: 6_000 },
  /** All three powers of attorney bill at the same rate per MetLife guidelines. */
  powerOfAttorney: { member: 6_000, couple: 8_500 },
  affidavit: { member: 6_500, couple: 6_500 },
  deed: { member: 9_000, couple: 9_000 },
} as const

export type MetlifeFeeKey = keyof typeof METLIFE_FEES

export function feeCents(key: MetlifeFeeKey, rate: 'member' | 'couple') {
  return METLIFE_FEES[key][rate]
}

/** The portal's Service Type for each fee. */
export const SERVICE_TYPE_BY_FEE: Record<MetlifeFeeKey, MetlifeServiceType> = {
  will: 'Will',
  trust: 'Trust - No Tax Planning',
  advancedMedicalDirective: 'Advanced Medical Directive',
  powerOfAttorney: 'Power of Attorney',
  affidavit: 'Affidavit',
  deed: 'Deed',
}

/** Massachusetts fee-schedule CT code for each estate-planning claim line. */
export const SERVICE_CODE_BY_FEE: Record<MetlifeFeeKey, string> = {
  will: '200',
  powerOfAttorney: '220',
  advancedMedicalDirective: '230',
  trust: '260',
  deed: '420',
  affidavit: '700',
}

export const METLIFE_FEE_SCHEDULE_SOURCE = {
  jurisdiction: 'Massachusetts',
  locationCode: '20907',
  title: 'Atty Fees 2024',
} as const

export type MetlifeScheduleInput = 'probate_assets' | 'inheritance_litigation_hours'

export interface MetlifeScheduleItem {
  key: string
  code: '200' | '220' | '230' | '250' | '260' | '270' | '420' | '700'
  label: string
  amountCents?: number
  input?: MetlifeScheduleInput
  inputLabel?: string
}

/**
 * The rows the firm uses for MetLife carrier claims. The CT 250 reduced-fee
 * entry is intentionally absent because the schedule says it is paid by the
 * member, not MetLife. CT 700 uses the attorney-prepared stand-alone rate the
 * firm selected, not the $30 preprinted-form rate.
 */
export const METLIFE_SCHEDULE_ITEMS: readonly MetlifeScheduleItem[] = [
  { key: 'will_individual', code: '200', label: 'Will with support trust/Codicil — Individual', amountCents: 15_000 },
  { key: 'will_reciprocal', code: '200', label: 'Reciprocal Wills — Member and Spouse', amountCents: 18_500 },
  { key: 'poa_individual', code: '220', label: 'Power of Attorney — Individual', amountCents: 6_000 },
  { key: 'poa_couple', code: '220', label: 'Power of Attorney — Member and Spouse', amountCents: 8_500 },
  { key: 'living_will_individual', code: '230', label: 'Living Will — Individual', amountCents: 4_500 },
  { key: 'living_will_couple', code: '230', label: 'Living Will — Member and Spouse', amountCents: 6_000 },
  { key: 'probate_affidavit', code: '250', label: 'Probate — Affidavit/Simple Procedure/Tax Only', amountCents: 45_000 },
  { key: 'probate_standard', code: '250', label: 'Probate — Standard/Court Supervised', input: 'probate_assets', inputLabel: 'Probate estate assets' },
  { key: 'trust_individual', code: '260', label: 'Trust — Individual', amountCents: 32_500 },
  { key: 'trust_couple', code: '260', label: 'Trust — Member and Spouse', amountCents: 40_000 },
  { key: 'inheritance_negotiation', code: '270', label: 'Inheritance Rights — Negotiation and Settlement', amountCents: 65_000 },
  { key: 'inheritance_litigation', code: '270', label: 'Inheritance Rights — Litigation', input: 'inheritance_litigation_hours', inputLabel: 'Total litigation hours' },
  { key: 'deed', code: '420', label: 'Deed', amountCents: 9_000 },
  { key: 'affidavit_prepared', code: '700', label: 'Other — Individually Prepared Stand-Alone Affidavit', amountCents: 6_500 },
] as const

export function metlifeScheduleLabel(item: MetlifeScheduleItem) {
  return `CT ${item.code} — ${item.label}`
}

/** CT 250: 1.5% through $100,000 (minimum $450), then 1% over it; $4,000 cap. */
export function metlifeProbateFeeCents(assetValueCents: number): number | null {
  if (!Number.isSafeInteger(assetValueCents) || assetValueCents < 0) return null
  const fee = assetValueCents <= 10_000_000
    ? Math.max(45_000, Math.round(assetValueCents * 0.015))
    : 150_000 + Math.round((assetValueCents - 10_000_000) * 0.01)
  return Math.min(400_000, fee)
}

/** CT 270: $1,000 through ten hours, then $100/hour; $2,000 case cap. */
export function metlifeInheritanceLitigationFeeCents(totalHours: number): number | null {
  if (!Number.isFinite(totalHours) || totalHours < 0) return null
  return Math.min(200_000, Math.round(100_000 + Math.max(0, totalHours - 10) * 10_000))
}

export function calculateMetlifeScheduleAmount(
  item: MetlifeScheduleItem,
  inputValue?: number,
): number | null {
  if (item.amountCents !== undefined) return item.amountCents
  if (inputValue === undefined) return null
  if (item.input === 'probate_assets') {
    return metlifeProbateFeeCents(Math.round(inputValue * 100))
  }
  if (item.input === 'inheritance_litigation_hours') {
    return metlifeInheritanceLitigationFeeCents(inputValue)
  }
  return null
}

/**
 * Aubrey Law's internal document names to MetLife's billing names. The claim
 * always bills under the MetLife name — the internal name never reaches a form.
 */
export const METLIFE_BILLING_NAMES: Record<string, string> = {
  'Durable Power of Attorney': 'Power of Attorney (Financial)',
  'Health Care Proxy': 'Power of Attorney (Medical)',
  'HIPAA Authorization': 'Power of Attorney (HIPAA)',
  'Living Will': 'Advanced Medical Directive',
  'Revocable Trust': 'Trust No-Tax Planning',
  'Certificate of Trust': 'Affidavit',
  'Minor Guardianship': 'Temporary Guardian Affidavit',
}

export function formatFee(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
