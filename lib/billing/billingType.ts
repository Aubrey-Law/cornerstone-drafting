/**
 * How a matter is paid, as one enum. `billing_type` used to be free text
 * alongside a second free-text `legal_plan` column, so the same matter could
 * say "MetLife" in one place and "Met Life plan" in the other. `legal_plan` is
 * now the display name derived from this — never an independent answer.
 */

export const MATTER_BILLING_TYPES = [
  'flat_fee',
  'metlife',
  'legalease',
  'arag',
  'hyatt',
  'legalshield',
  'other_legal_plan',
] as const

export type MatterBillingType = (typeof MATTER_BILLING_TYPES)[number]

export const MATTER_BILLING_TYPE_LABEL: Record<MatterBillingType, string> = {
  flat_fee: 'Flat fee',
  metlife: 'MetLife',
  legalease: 'LegalEASE',
  arag: 'ARAG',
  hyatt: 'Hyatt',
  legalshield: 'LegalShield',
  other_legal_plan: 'Other legal plan',
}

export const MATTER_BILLING_TYPE_OPTIONS: Array<{ value: MatterBillingType; label: string }> =
  MATTER_BILLING_TYPES.map(value => ({ value, label: MATTER_BILLING_TYPE_LABEL[value] }))

/** Matches the SQL backfill, so a row read before the migration lands still resolves. */
export function normalizeMatterBillingType(value: unknown): MatterBillingType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if ((MATTER_BILLING_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed as MatterBillingType
  }
  if (trimmed.includes('metlife') || trimmed.includes('met life')) return 'metlife'
  if (trimmed.includes('legalease')) return 'legalease'
  if (trimmed.includes('arag')) return 'arag'
  if (trimmed.includes('hyatt')) return 'hyatt'
  if (trimmed.includes('legalshield') || trimmed.includes('legal shield')) return 'legalshield'
  if (trimmed.includes('plan')) return 'other_legal_plan'
  if (trimmed.includes('flat')) return 'flat_fee'
  return null
}

/** The plan's display name, or null for a flat-fee matter. */
export function legalPlanDisplayName(value: unknown): string | null {
  const normalized = normalizeMatterBillingType(value)
  if (!normalized || normalized === 'flat_fee') return null
  return MATTER_BILLING_TYPE_LABEL[normalized]
}

/** Flat-fee matters have no claim, so the claim block never renders for them. */
export function isLegalPlanBilling(value: unknown): boolean {
  const normalized = normalizeMatterBillingType(value)
  return normalized !== null && normalized !== 'flat_fee'
}
