/**
 * What it means for an asset to be inside the plan.
 *
 * An unfunded trust is the largest malpractice exposure in this practice: the
 * documents are perfect, the client believes they are protected, and the assets
 * pass through probate anyway because nobody changed the title. This module is
 * the vocabulary for tracking that, and one rule in it is load-bearing enough
 * to be worth reading before anything else — see `methodIsPermitted`.
 *
 * Pure, so every rule is a table in a test rather than something asserted
 * through a database.
 */

/**
 * The categories the intake form actually writes, read off the live table.
 *
 * Worth stating because the old app's funding-plan map disagrees with reality —
 * it lists `real_property` and `financial`, which match nothing, so every real
 * estate and bank asset it labels comes out as "Other".
 */
export const ASSET_CATEGORIES = [
  'real_estate',
  'bank',
  'investment',
  'retirement',
  'life_insurance',
  'business',
  'crypto',
  'vehicles',
  'inheritance',
  'other',
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number] | (string & {})

const CATEGORY_LABELS: Record<string, string> = {
  real_estate: 'Real estate',
  bank: 'Bank account',
  investment: 'Investment account',
  retirement: 'Retirement account',
  life_insurance: 'Life insurance',
  business: 'Business interest',
  crypto: 'Digital asset',
  vehicles: 'Vehicle',
  inheritance: 'Expected inheritance',
  other: 'Other',
}

/** Falls back to the raw value: inventing a label for an unknown category hides it. */
export function categoryLabel(category: AssetCategory): string {
  return CATEGORY_LABELS[category] ?? category
}

/** How an asset gets into the plan. */
export const FUNDING_METHODS = [
  'undecided',
  'deed',
  'retitle',
  'beneficiary',
  'assignment',
  'none_required',
] as const

export type FundingMethod = (typeof FUNDING_METHODS)[number]

export const FUNDING_METHOD_LABELS: Record<FundingMethod, string> = {
  undecided: 'Not decided',
  deed: 'New deed',
  retitle: 'Retitle to the trust',
  beneficiary: 'Beneficiary designation',
  assignment: 'Assignment of interest',
  none_required: 'Nothing required',
}

/** The work, in the order it happens. */
export const FUNDING_STATUSES = [
  'not_started',
  'in_progress',
  'awaiting_confirmation',
  'confirmed',
  'not_applicable',
] as const

export type FundingStatus = (typeof FUNDING_STATUSES)[number]

export const FUNDING_STATUS_LABELS: Record<FundingStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  not_applicable: 'Not applicable',
}

const DEFAULT_METHODS: Record<string, FundingMethod> = {
  real_estate: 'deed',
  bank: 'retitle',
  investment: 'retitle',
  business: 'assignment',
  retirement: 'beneficiary',
  life_insurance: 'beneficiary',
}

/**
 * The method this category usually calls for, or `undecided`.
 *
 * Undecided rather than guessed for the rest. A vehicle is rarely retitled into
 * a revocable trust in Massachusetts, an expected inheritance may be a mere
 * expectancy with nothing yet to transfer, and "other" is unknown by
 * definition. A default that is wrong reads as advice.
 */
export function defaultMethodFor(category: AssetCategory): FundingMethod {
  return DEFAULT_METHODS[category] ?? 'undecided'
}

/**
 * Methods this category must never be recorded under.
 *
 * Retitling an IRA or a 401(k) into a revocable trust is not a transfer, it is
 * a distribution: the whole account becomes taxable income that year. Such
 * accounts join the plan by beneficiary designation. A tracker that accepted
 * "retitled" against a retirement account would be recording the most expensive
 * mistake in estate funding as though it were progress.
 *
 * Only what is unambiguously wrong is refused. Assigning ownership of a life
 * insurance policy, by contrast, is real practice — it belongs to an
 * irrevocable trust rather than this one, which is a judgement for the attorney
 * and not a rule for this table.
 */
const FORBIDDEN_METHODS: Record<string, readonly FundingMethod[]> = {
  retirement: ['deed', 'retitle'],
}

export function methodIsPermitted(category: AssetCategory, method: FundingMethod): boolean {
  return !(FORBIDDEN_METHODS[category] ?? []).includes(method)
}

export function permittedMethodsFor(category: AssetCategory): FundingMethod[] {
  return FUNDING_METHODS.filter((method) => methodIsPermitted(category, method))
}

/**
 * Whether this asset still needs work.
 *
 * `awaiting_confirmation` is deliberately *not* funded. Paperwork sent is
 * exactly the state in which everyone assumes a trust is funded and it is not:
 * the institution can reject the request, and without confirmation nobody finds
 * out until it matters most.
 */
export function isFunded(status: FundingStatus): boolean {
  return status === 'confirmed' || status === 'not_applicable'
}

/** Postgres `numeric` arrives as a string often enough to handle here. */
function toAmount(value: unknown): number {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
}

export interface FundableAsset {
  value: number | string | null
  status: FundingStatus
  category: AssetCategory
}

export interface FundingSummary {
  total: number
  fundedCount: number
  unfundedCount: number
  fundedValue: number
  /** The figure that makes a client act. */
  unfundedValue: number
  isComplete: boolean
}

export function fundingSummary(assets: readonly FundableAsset[]): FundingSummary {
  let fundedCount = 0
  let unfundedCount = 0
  let fundedValue = 0
  let unfundedValue = 0

  for (const asset of assets) {
    const amount = toAmount(asset.value)
    if (isFunded(asset.status)) {
      fundedCount += 1
      fundedValue += amount
    } else {
      unfundedCount += 1
      unfundedValue += amount
    }
  }

  return {
    total: assets.length,
    fundedCount,
    unfundedCount,
    fundedValue,
    unfundedValue,
    // An empty list is not complete: it means intake captured no assets, which
    // is a reason to look rather than a reason to relax.
    isComplete: assets.length > 0 && unfundedCount === 0,
  }
}
