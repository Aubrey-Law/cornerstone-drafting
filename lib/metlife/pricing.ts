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
  advancedMedicalDirective: { member: 4_500, couple: 6_500 },
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
