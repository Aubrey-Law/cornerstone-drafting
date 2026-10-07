/**
 * ARAG's attorney fee schedule, effective February 1, 2026, in integer cents.
 * Only the rows an estate planning and probate practice bills are listed; the
 * schedule's consumer, family, criminal and traffic rows are left out.
 *
 * ARAG pays the schedule amount as the whole fee for the covered matter.
 * Paid-in-full matters are paid once the entire matter is complete, and a
 * standalone estate plan is complete when executable documents go to the
 * member, or after 90 days without contact, whichever is first. The member's
 * case confirmation says whether the plan is paid-in-full or hourly.
 */

export const ARAG_FEE_SCHEDULE_SOURCE = {
  title: 'ARAG Fee Schedule',
  effective: '2026-02-01',
} as const

/**
 * What a row is priced on when it is not a fixed amount:
 * - `probate_assets`: dollars of probate assets at death (paid-in-full probate)
 * - `hours`: hours worked on an hourly coverage plan
 * - `documents`: how many of the document were prepared
 * - `claim_value`: dollars of the benefit claim (Social Security, Medicaid, VA)
 */
export type AragScheduleInput = 'probate_assets' | 'hours' | 'documents' | 'claim_value'

export interface AragScheduleItem {
  key: string
  section: string
  label: string
  amountCents?: number
  input?: AragScheduleInput
  inputLabel?: string
  /** Per hour or per document. */
  rateCents?: number
  /** The most ARAG pays, whatever the hours, documents or claim value. */
  maxCents?: number
}

const HOURLY = 10_000

export const ARAG_SCHEDULE_ITEMS: readonly AragScheduleItem[] = [
  { key: 'initial_consultation', section: 'Initial consultation', label: 'Initial consultation', amountCents: 2_500 },

  { key: 'will_individual', section: 'Wills', label: 'Individual will package', amountCents: 38_000 },
  { key: 'will_combined', section: 'Wills', label: 'Combined will package — Member and Spouse/Partner', amountCents: 45_500 },
  { key: 'trust_individual', section: 'Trusts', label: 'Individual trust', amountCents: 39_000 },
  { key: 'trust_combined', section: 'Trusts', label: 'Combined trust — Member and Spouse/Partner', amountCents: 49_500 },
  { key: 'trust_amendment', section: 'Trusts', label: 'Amendment/modification of covered trust', amountCents: 15_000 },
  { key: 'trust_funding', section: 'Trusts', label: 'Funding an existing trust', amountCents: 25_000 },

  { key: 'probate_paid_in_full', section: 'Estate administration/probate', label: 'Paid-in-full plan', input: 'probate_assets', inputLabel: 'Probate estate assets' },
  { key: 'probate_hourly', section: 'Estate administration/probate', label: 'Hourly coverage plan', input: 'hours', inputLabel: 'Hours', rateCents: HOURLY },
  { key: 'executor_uncontested', section: 'Executor appointment', label: 'Level 2 — Uncontested', amountCents: 21_000 },
  { key: 'executor_contested', section: 'Executor appointment', label: 'Level 2 — Contested', amountCents: 94_000 },
  { key: 'inheritance_paid_in_full', section: 'Protection of inheritance rights', label: 'Paid-in-full plan', amountCents: 63_500 },
  { key: 'inheritance_hourly', section: 'Protection of inheritance rights', label: 'Hourly coverage plan', input: 'hours', inputLabel: 'Hours', rateCents: HOURLY },
  { key: 'trust_dispute_l1', section: 'Trust dispute', label: 'Level 1', amountCents: 21_500 },
  { key: 'trust_dispute_l2', section: 'Trust dispute', label: 'Level 2 (without trial)', amountCents: 119_000 },
  { key: 'trust_dispute_l2_trial', section: 'Trust dispute', label: 'Level 2 (with trial)', amountCents: 166_500 },

  { key: 'guardianship_l1', section: 'Guardianship/conservatorship', label: 'Appointment/defense — Level 1', amountCents: 21_000 },
  { key: 'guardianship_l2_uncontested', section: 'Guardianship/conservatorship', label: 'Appointment/defense — Level 2 (uncontested)', amountCents: 60_500 },
  { key: 'guardianship_l2_contested', section: 'Guardianship/conservatorship', label: 'Appointment/defense — Level 2 (contested)', amountCents: 97_000 },
  { key: 'guardianship_accounting', section: 'Guardianship/conservatorship', label: 'Annual accounting', amountCents: 21_000 },
  { key: 'incapacity_proceedings', section: 'Insanity/incapacity/infirmity proceedings', label: 'Proceedings', amountCents: 126_500 },
  { key: 'elder_review_short', section: 'Elder law', label: 'Review of documents, 1–10 pages', amountCents: 5_500 },
  { key: 'elder_review_long', section: 'Elder law', label: 'Review of documents, 11 or more pages', amountCents: 8_000 },
  { key: 'annual_checkup', section: 'Annual legal check up for parents/grandparents', label: 'Check up', amountCents: 10_000 },
  { key: 'benefits_administrative', section: 'Administrative — Social Security/Medicaid/Veterans', label: 'Benefit claim', input: 'claim_value', inputLabel: 'Claim value', maxCents: 100_000 },

  { key: 'doc_affidavit', section: 'Specific document', label: 'Affidavit', input: 'documents', inputLabel: 'Documents', rateCents: 5_500, maxCents: 16_500 },
  { key: 'doc_trust_certification', section: 'Specific document', label: 'Certification of trust', input: 'documents', inputLabel: 'Documents', rateCents: 5_500, maxCents: 16_500 },
  { key: 'doc_codicil', section: 'Specific document', label: 'Codicil or amendment/revision of will', input: 'documents', inputLabel: 'Documents', rateCents: 5_000, maxCents: 15_000 },
  { key: 'doc_deed', section: 'Specific document', label: 'Deed', input: 'documents', inputLabel: 'Deeds', rateCents: 5_500, maxCents: 27_500 },
  { key: 'doc_poa_single', section: 'Specific document', label: 'Durable power of attorney — Single', input: 'documents', inputLabel: 'Documents', rateCents: 5_000, maxCents: 15_000 },
  { key: 'doc_poa_couple', section: 'Specific document', label: 'Durable power of attorney — Member and Spouse/Partner', input: 'documents', inputLabel: 'Documents', rateCents: 10_000, maxCents: 30_000 },
  { key: 'doc_funeral_directive', section: 'Specific document', label: 'Funeral directive', input: 'documents', inputLabel: 'Documents', rateCents: 5_500, maxCents: 16_500 },
  { key: 'doc_hipaa', section: 'Specific document', label: 'HIPAA authorization', input: 'documents', inputLabel: 'Documents', rateCents: 5_500, maxCents: 16_500 },
  { key: 'doc_hospital_visitation', section: 'Specific document', label: 'Hospital visitation authorization', input: 'documents', inputLabel: 'Documents', rateCents: 5_500, maxCents: 16_500 },
  { key: 'doc_living_will', section: 'Specific document', label: 'Living will and/or health care power of attorney', input: 'documents', inputLabel: 'Documents', rateCents: 5_000, maxCents: 15_000 },

  { key: 'general_hourly', section: 'General in-office/miscellaneous services', label: 'Hourly', input: 'hours', inputLabel: 'Hours', rateCents: HOURLY },
] as const

export function aragScheduleLabel(item: AragScheduleItem) {
  return `ARAG ${item.section} — ${item.label}`
}

/** Paid-in-full probate: 1.25% of probate assets, minimum $1,000, maximum $4,000. */
export function aragProbateFeeCents(assetValueCents: number): number | null {
  if (!Number.isSafeInteger(assetValueCents) || assetValueCents < 0) return null
  return Math.min(400_000, Math.max(100_000, Math.round(assetValueCents * 0.0125)))
}

/** Social Security, Medicaid or VA hearing: 20% of the claim value, maximum $1,000. */
export function aragBenefitClaimFeeCents(claimValueCents: number): number | null {
  if (!Number.isSafeInteger(claimValueCents) || claimValueCents < 0) return null
  return Math.min(100_000, Math.round(claimValueCents * 0.2))
}

export function calculateAragScheduleAmount(item: AragScheduleItem, inputValue?: number): number | null {
  if (item.amountCents !== undefined) return item.amountCents
  if (inputValue === undefined || !Number.isFinite(inputValue) || inputValue < 0) return null
  switch (item.input) {
    case 'probate_assets':
      return aragProbateFeeCents(Math.round(inputValue * 100))
    case 'claim_value':
      return aragBenefitClaimFeeCents(Math.round(inputValue * 100))
    case 'hours':
      return item.rateCents === undefined ? null : Math.round(inputValue * item.rateCents)
    case 'documents': {
      // ARAG pays per document up to a cap, so a fraction of a document is not a count.
      if (!Number.isInteger(inputValue) || inputValue < 1 || item.rateCents === undefined) return null
      const cents = inputValue * item.rateCents
      return item.maxCents === undefined ? cents : Math.min(item.maxCents, cents)
    }
    default:
      return null
  }
}

/** The rule shown under the input, in the schedule's own terms. */
export function aragInputHelp(item: AragScheduleItem): string | null {
  const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`
  switch (item.input) {
    case 'probate_assets':
      return 'Assets subject to probate at death. 1.25% of assets, minimum $1,000, maximum $4,000.'
    case 'claim_value':
      return '20% of the claim value, maximum $1,000.'
    case 'hours':
      return `${dollars(item.rateCents ?? HOURLY)} per hour, up to the hours on the case confirmation. Claim within 180 days once covered hours run out.`
    case 'documents':
      return `${dollars(item.rateCents ?? 0)} per document, maximum ${dollars(item.maxCents ?? 0)}.`
    default:
      return null
  }
}
