import { ASSET_CATEGORIES } from '@/lib/estateTax'

/** Filter chips shown above the asset table (screenshot-aligned subset + All). */
export const ASSET_FILTER_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'real_estate', label: 'Real Property' },
  { key: 'bank', label: 'Bank Accounts' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'retirement', label: 'Retirement Accounts' },
  { key: 'investment', label: 'Investment Accounts' },
  { key: 'other', label: 'Other Assets' },
] as const

export type AssetFilterKey = (typeof ASSET_FILTER_CHIPS)[number]['key']

export { ASSET_CATEGORIES }

export const ASSET_CHART_COLORS = [
  '#1e3a5f',
  '#2563eb',
  '#0d9488',
  '#7c3aed',
  '#ea580c',
  '#ca8a04',
  '#64748b',
  '#db2777',
  '#059669',
  '#475569',
  '#94a3b8',
] as const
