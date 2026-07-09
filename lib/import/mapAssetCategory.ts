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
  retirement: 'retirement',
  retirement_accounts: 'retirement',
  life_insurance: 'life_insurance',
  business: 'business',
  business_interests: 'business',
  vehicles: 'vehicles',
  vehicle: 'vehicles',
  personal_property: 'personal_property',
  inheritance: 'inheritance',
  crypto: 'crypto',
  other: 'other',
  other_assets: 'other',
}

export function mapImportedAssetCategory(raw: unknown): AssetCategory {
  const key = String(raw ?? 'other').toLowerCase().replace(/\s+/g, '_')
  return AI_CATEGORY_MAP[key] ?? 'other'
}
