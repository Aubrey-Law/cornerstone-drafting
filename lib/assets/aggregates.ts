import type { AssetIntakeRow } from '@/types/assetIntake'
import type { AssetCategory, Ownership } from '@/lib/estateTax'
import { ASSET_CATEGORIES } from '@/lib/estateTax'

export function assetDebt(asset: AssetIntakeRow): number {
  const details = asset.details ?? {}
  const mortgage = Number(details.mortgage_balance)
  const debt = Number(details.debt)
  if (!Number.isNaN(mortgage) && mortgage > 0) return mortgage
  if (!Number.isNaN(debt) && debt > 0) return debt
  return 0
}

export function assetNetValue(asset: AssetIntakeRow): number {
  const value = Number(asset.value) || 0
  return Math.max(0, value - assetDebt(asset))
}

export function assetDocumentCount(asset: AssetIntakeRow): number {
  const ids = asset.details?.document_ids
  return Array.isArray(ids) ? ids.length : 0
}

export interface AssetAggregates {
  grossValue: number
  totalDebt: number
  netValue: number
  valuedAssetCount: number
  documentRecordCount: number
  byCategory: Record<string, { total: number; debt: number; net: number; count: number }>
  byOwnership: Record<Ownership, { total: number; count: number }>
}

export function computeAssetAggregates(assets: AssetIntakeRow[]): AssetAggregates {
  const byCategory: AssetAggregates['byCategory'] = {}
  const byOwnership: AssetAggregates['byOwnership'] = {
    client: { total: 0, count: 0 },
    spouse: { total: 0, count: 0 },
    joint: { total: 0, count: 0 },
  }

  let grossValue = 0
  let totalDebt = 0
  let valuedAssetCount = 0
  let documentRecordCount = 0

  for (const asset of assets) {
    const value = Number(asset.value) || 0
    const debt = assetDebt(asset)
    const net = Math.max(0, value - debt)
    const cat = asset.category || 'other'

    grossValue += value
    totalDebt += debt
    if (value > 0) valuedAssetCount += 1
    documentRecordCount += assetDocumentCount(asset)

    if (!byCategory[cat]) byCategory[cat] = { total: 0, debt: 0, net: 0, count: 0 }
    byCategory[cat].total += value
    byCategory[cat].debt += debt
    byCategory[cat].net += net
    byCategory[cat].count += 1

    const own = (asset.ownership ?? 'client') as Ownership
    if (byOwnership[own]) {
      byOwnership[own].total += value
      byOwnership[own].count += 1
    }
  }

  return {
    grossValue,
    totalDebt,
    netValue: Math.max(0, grossValue - totalDebt),
    valuedAssetCount,
    documentRecordCount,
    byCategory,
    byOwnership,
  }
}

export interface CategoryGroup {
  key: string
  label: string
  assets: AssetIntakeRow[]
  total: number
  debt: number
  net: number
}

export function groupAssetsByCategory(
  assets: AssetIntakeRow[],
  filterKey?: string | null,
): CategoryGroup[] {
  const filtered = filterKey && filterKey !== 'all'
    ? assets.filter(a => a.category === filterKey)
    : assets

  const order = ASSET_CATEGORIES.map(c => c.key)
  const buckets = new Map<string, AssetIntakeRow[]>()

  for (const asset of filtered) {
    const key = asset.category || 'other'
    const list = buckets.get(key) ?? []
    list.push(asset)
    buckets.set(key, list)
  }

  const groups: CategoryGroup[] = []
  const seen = new Set<string>()

  for (const key of order) {
    const meta = ASSET_CATEGORIES.find(c => c.key === key)
    const list = buckets.get(key)
    if (!list?.length || !meta) continue
    seen.add(key)
    groups.push({
      key,
      label: meta.label,
      assets: list,
      total: list.reduce((s, a) => s + (Number(a.value) || 0), 0),
      debt: list.reduce((s, a) => s + assetDebt(a), 0),
      net: list.reduce((s, a) => s + assetNetValue(a), 0),
    })
  }

  for (const [key, list] of buckets) {
    if (seen.has(key)) continue
    groups.push({
      key,
      label: key,
      assets: list,
      total: list.reduce((s, a) => s + (Number(a.value) || 0), 0),
      debt: list.reduce((s, a) => s + assetDebt(a), 0),
      net: list.reduce((s, a) => s + assetNetValue(a), 0),
    })
  }

  return groups
}

export function categoryLabel(key: string): string {
  return ASSET_CATEGORIES.find(c => c.key === key)?.label ?? key
}

export type { AssetCategory }
