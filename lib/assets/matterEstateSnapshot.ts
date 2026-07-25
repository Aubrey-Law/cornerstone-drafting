import { calculateMAEstateTax } from '@/lib/estateTax'

export interface MatterEstateAsset {
  category: string
  value: number | null
  details: Record<string, unknown> | null
  updated_at: string | null
}

export interface MatterEstateSnapshot {
  assetCount: number
  ownedAssetValue: number
  deathBenefit: number
  grossEstateEstimate: number
  totalDebt: number
  netInventoryValue: number
  estimatedMaTax: number
  latestAssetUpdatedAt: string | null
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function assetDebt(asset: MatterEstateAsset): number {
  const details = asset.details ?? {}
  return positiveNumber(details.mortgage_balance) || positiveNumber(details.debt)
}

export function computeMatterEstateSnapshot(
  assets: MatterEstateAsset[],
): MatterEstateSnapshot {
  let ownedAssetValue = 0
  let deathBenefit = 0
  let totalDebt = 0
  let latestAssetUpdatedAt: string | null = null

  for (const asset of assets) {
    const value = positiveNumber(asset.value)
    if (asset.category === 'life_insurance') deathBenefit += value
    else ownedAssetValue += value
    totalDebt += assetDebt(asset)

    if (
      asset.updated_at
      && (!latestAssetUpdatedAt || Date.parse(asset.updated_at) > Date.parse(latestAssetUpdatedAt))
    ) {
      latestAssetUpdatedAt = asset.updated_at
    }
  }

  const grossEstateEstimate = ownedAssetValue + deathBenefit
  return {
    assetCount: assets.length,
    ownedAssetValue,
    deathBenefit,
    grossEstateEstimate,
    totalDebt,
    netInventoryValue: Math.max(0, grossEstateEstimate - totalDebt),
    estimatedMaTax: calculateMAEstateTax(grossEstateEstimate),
    latestAssetUpdatedAt,
  }
}

export const EMPTY_MATTER_ESTATE_SNAPSHOT: MatterEstateSnapshot = {
  assetCount: 0,
  ownedAssetValue: 0,
  deathBenefit: 0,
  grossEstateEstimate: 0,
  totalDebt: 0,
  netInventoryValue: 0,
  estimatedMaTax: 0,
  latestAssetUpdatedAt: null,
}
