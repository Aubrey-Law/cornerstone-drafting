/** Keys nested inside `client_intake.financial_details` but surfaced at root in the wizard UI. */
export const FINANCIAL_DETAILS_ROOT_KEYS = [
  'asset_types',
  'owns_real_estate_outside_ma',
  'has_business_interest',
  'has_special_needs_dependent',
  'has_prior_marriage',
  'expects_inheritance',
  'has_charitable_intent',
] as const

export type FinancialDetailsRootKey = (typeof FINANCIAL_DETAILS_ROOT_KEYS)[number]

export function isFinancialDetailsRootKey(k: string): k is FinancialDetailsRootKey {
  return (FINANCIAL_DETAILS_ROOT_KEYS as readonly string[]).includes(k)
}
