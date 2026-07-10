import type { AssetCategory } from '@/lib/estateTax'

const AI_CATEGORY_MAP: Record<string, AssetCategory> = {
  real_estate: 'real_estate',
  real_property: 'real_estate',
  bank: 'bank',
  bank_accounts: 'bank',
  bank_account: 'bank',
  investment: 'investment',
  investments: 'investment',
  investment_accounts: 'investment',
  non_retirement_accounts: 'investment',
  stock_bonds_brokerage_accounts: 'investment',
  retirement: 'retirement',
  retirement_accounts: 'retirement',
  life_insurance: 'life_insurance',
  business: 'business',
  business_interests: 'business',
  business_you_own: 'business',
  vehicles: 'vehicles',
  vehicle: 'vehicles',
  vehicles_and_other_titled_moving_property: 'vehicles',
  personal_property: 'personal_property',
  household_tangible_personal_property: 'personal_property',
  inheritance: 'inheritance',
  anticipated_inheritance: 'inheritance',
  anticipated_inheritance_gift_or_judgment: 'inheritance',
  crypto: 'crypto',
  cryptocurrencies: 'crypto',
  other: 'other',
  other_assets: 'other',
  custodial_accounts: 'other',
  annuities: 'other',
  safe_deposit_box: 'other',
  loan_receivable_to_you: 'other',
}

export function mapImportedAssetCategory(raw: unknown): AssetCategory {
  const key = String(raw ?? 'other')
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '')
  return AI_CATEGORY_MAP[key] ?? 'other'
}
