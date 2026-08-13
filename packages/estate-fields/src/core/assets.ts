import type { FieldOption } from './types'

export type AssetCategory =
  | 'real_property'
  | 'financial'
  | 'retirement'
  | 'life_insurance'
  | 'business'
  | 'other'

/** Client intake estate-value ranges (canonical select options). */
export const ESTATE_VALUE_OPTIONS: FieldOption[] = [
  { value: 'under_500k', label: 'Under $500,000' },
  { value: '500k_2m', label: '$500,000 to $2 million' },
  { value: '2m_4m', label: '$2 million to $4 million' },
  { value: '4m_6m', label: '$4 million to $6 million' },
  { value: 'over_6m', label: 'Over $6 million' },
]

/** Lead-form legacy ranges (still accepted for midpoint math + label lookup). */
export const ESTATE_VALUE_LEAD_RANGE_OPTIONS: FieldOption[] = [
  { value: 'under_500k', label: 'Under $500K' },
  { value: '500k_to_1m', label: '$500K - $1M' },
  { value: '1m_to_2m', label: '$1M - $2M' },
  { value: '2m_to_5m', label: '$2M - $5M' },
  { value: 'over_5m', label: 'Over $5M' },
]

/** Legacy admin/import values — label lookup only; not offered on new client intake. */
export const LEGACY_ESTATE_VALUE_OPTIONS: FieldOption[] = [
  { value: '500k_to_1m', label: '$500K – $1M' },
  { value: '1m_to_2m', label: '$1M – $2M' },
  { value: '2m_to_5m', label: '$2M – $5M' },
  { value: 'over_5m', label: 'Over $5M' },
  { value: 'unsure', label: 'Not sure' },
  { value: 'under_2m', label: 'Under $2 million' },
]

export type EstateValueKey =
  | (typeof ESTATE_VALUE_OPTIONS)[number]['value']
  | (typeof ESTATE_VALUE_LEAD_RANGE_OPTIONS)[number]['value']

const ESTATE_VALUE_LABELS = new Map(
  [...ESTATE_VALUE_OPTIONS, ...ESTATE_VALUE_LEAD_RANGE_OPTIONS, ...LEGACY_ESTATE_VALUE_OPTIONS].map((o) => [o.value, o.label]),
)

/** Numeric midpoints for pipeline estimates (canonical + legacy keys). */
export const ESTATE_VALUE_MIDPOINTS: Record<string, number> = {
  under_500k: 400_000,
  '500k_2m': 1_250_000,
  '2m_4m': 3_000_000,
  '4m_6m': 5_000_000,
  over_6m: 7_000_000,
  '500k_to_1m': 750_000,
  '1m_to_2m': 1_500_000,
  '2m_to_5m': 3_500_000,
  over_5m: 6_000_000,
}

const ESTATE_VALUE_ALIASES: Record<string, string> = {
  under_500k: 'under_500k',
  'under $500k': 'under_500k',
  'under 500k': 'under_500k',
  'less than $500k': 'under_500k',
  '500k_to_1m': '500k_to_1m',
  '500k_1m': '500k_to_1m',
  '$500k - $1m': '500k_to_1m',
  '$500k – $1m': '500k_to_1m',
  '500k - 1m': '500k_to_1m',
  '500k to 1m': '500k_to_1m',
  '500k_2m': '500k_2m',
  '1m_to_2m': '1m_to_2m',
  '1m_2m': '1m_to_2m',
  '$1m - $2m': '1m_to_2m',
  '$1m – $2m': '1m_to_2m',
  '1m - 2m': '1m_to_2m',
  '1m to 2m': '1m_to_2m',
  '2m_to_5m': '2m_to_5m',
  '2m_5m': '2m_to_5m',
  '$2m - $5m': '2m_to_5m',
  '$2m – $5m': '2m_to_5m',
  '2m - 5m': '2m_to_5m',
  '2m to 5m': '2m_to_5m',
  '2m_4m': '2m_4m',
  '4m_6m': '4m_6m',
  over_5m: 'over_5m',
  'over $5m': 'over_5m',
  'over 5m': 'over_5m',
  over_6m: 'over_6m',
}

function normalizeAliasInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
}

export function normalizeEstateValueKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (ESTATE_VALUE_MIDPOINTS[raw] !== undefined) return raw
  return ESTATE_VALUE_ALIASES[normalizeAliasInput(raw)] ?? null
}

export function estateValueMidpoint(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  const normalized = normalizeEstateValueKey(value)
  if (normalized && ESTATE_VALUE_MIDPOINTS[normalized] !== undefined) {
    return ESTATE_VALUE_MIDPOINTS[normalized]
  }
  if (typeof value !== 'string') return null
  const numeric = Number(value.replace(/[$,]/g, '').trim())
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

export function estateValueLabel(raw: unknown): string {
  if (raw == null || raw === '') return ''
  const normalized = normalizeEstateValueKey(raw)
  if (normalized) {
    return ESTATE_VALUE_LABELS.get(normalized) ?? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  const value = String(raw).trim()
  return ESTATE_VALUE_LABELS.get(value) ?? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Intake financial step asset-type toggles. */
export const INTAKE_ASSET_TYPE_OPTIONS: FieldOption[] = [
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'bank_accounts', label: 'Bank Accounts' },
  { value: 'investment_accounts', label: 'Investment Accounts (Non-Retirement)' },
  { value: 'retirement_accounts', label: 'Retirement Accounts' },
  { value: 'life_insurance', label: 'Life Insurance' },
  { value: 'business_interests', label: 'Business Interests' },
  { value: 'custodial_accounts', label: 'Custodial Accounts' },
  { value: 'cryptocurrencies', label: 'Cryptocurrency' },
  { value: 'personal_property', label: 'Personal Property' },
  { value: 'other_assets', label: 'Other Assets' },
  { value: 'liabilities', label: 'Liabilities / Money You Owe' },
]

const ASSET_TYPE_LABELS = new Map(INTAKE_ASSET_TYPE_OPTIONS.map((o) => [o.value, o.label]))

export function assetTypeLabel(value: string): string {
  return ASSET_TYPE_LABELS.get(value) ?? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatAssetTypesForReview(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return ''
  return raw.map((item) => assetTypeLabel(String(item))).join(', ')
}

/** Asset keys whose intake modal captures owner-split dollar totals. */
export const INTAKE_ASSET_TOTALS_KEYS = [
  'bank_accounts',
  'investment_accounts',
  'retirement_accounts',
  'life_insurance',
  'custodial_accounts',
  'cryptocurrencies',
] as const

export type IntakeAssetTotalsKey = (typeof INTAKE_ASSET_TOTALS_KEYS)[number]

export const INTAKE_ASSET_TYPE_VALUES = INTAKE_ASSET_TYPE_OPTIONS.map((o) => o.value)

export const SPECIAL_CIRCUMSTANCE_OPTIONS: FieldOption[] = [
  { value: 'owns_real_estate_outside_ma', label: 'I own real estate outside Massachusetts' },
  { value: 'has_business_interest', label: 'I own or co-own a business' },
  { value: 'has_special_needs_dependent', label: 'I have a dependent with special needs' },
  { value: 'has_prior_marriage', label: 'I have children from a prior relationship' },
  { value: 'expects_inheritance', label: 'I expect to receive a significant inheritance' },
  { value: 'has_charitable_intent', label: 'I want to include charitable giving in my plan' },
]

/** Design-sheet asset inventory categories (`AssetsSection`). */
export const DESIGN_ASSET_CATEGORY_OPTIONS: {
  value: AssetCategory
  label: string
  color: string
}[] = [
  { value: 'real_property', label: 'Real Property', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/50' },
  { value: 'financial', label: 'Financial Account', color: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800/50' },
  { value: 'retirement', label: 'Retirement', color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800/50' },
  { value: 'life_insurance', label: 'Life Insurance', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800/50' },
  { value: 'business', label: 'Business Interest', color: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800/50' },
  { value: 'other', label: 'Other', color: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-700/60' },
]

export function designAssetCategoryMeta(cat: AssetCategory) {
  return DESIGN_ASSET_CATEGORY_OPTIONS.find((c) => c.value === cat) ?? DESIGN_ASSET_CATEGORY_OPTIONS[DESIGN_ASSET_CATEGORY_OPTIONS.length - 1]
}

/** Intake financial-detail keys → human labels for review summaries. */
export const INTAKE_FINANCIAL_DETAIL_LABELS: Record<string, string> = {
  real_estate: 'Real estate',
  bank_accounts: 'Bank accounts',
  investment_accounts: 'Investments',
  retirement_accounts: 'Retirement',
  life_insurance: 'Life insurance',
  business_interests: 'Business interests',
  custodial_accounts: 'Custodial accounts',
  cryptocurrencies: 'Cryptocurrency',
  liabilities: 'Liabilities',
  personal_property: 'Personal property',
  other_assets: 'Other assets',
}
