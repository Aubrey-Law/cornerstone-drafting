import { calculateMAEstateTax, calculateMAEstateTaxWithCreditShelter } from '@/lib/estateTax'

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
  /** Life insurance face value, tracked on its own rather than as owned value. */
  lifeInsuranceFace: number
  businessInterests: number
  anticipatedInheritance: number
  grossEstateEstimate: number
  /**
   * Gross estate less the life-insurance face value — what the exposure would
   * be if the policies sat in an ILIT. Reported beside the tax, never used as
   * the tax base: a policy the client still owns is in their taxable estate,
   * and quietly netting it out would understate every unplanned matter.
   */
  estateExcludingLifeInsurance: number
  totalDebt: number
  netInventoryValue: number
  estimatedMaTax: number
  /** The same estate under a credit-shelter (two-trust) plan. */
  maTaxWithCreditShelter: number
  /** What the credit shelter saves — the number the design meeting turns on. */
  creditShelterSavings: number
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

/** Face value where it is recorded separately, else the asset's own value. */
function faceValue(asset: MatterEstateAsset): number {
  const details = asset.details ?? {}
  return positiveNumber(details.face_value)
    || positiveNumber(details.death_benefit)
    || positiveNumber(asset.value)
}

export function computeMatterEstateSnapshot(
  assets: MatterEstateAsset[],
): MatterEstateSnapshot {
  let ownedAssetValue = 0
  let deathBenefit = 0
  let lifeInsuranceFace = 0
  let businessInterests = 0
  let anticipatedInheritance = 0
  let totalDebt = 0
  let latestAssetUpdatedAt: string | null = null

  for (const asset of assets) {
    const value = positiveNumber(asset.value)
    if (asset.category === 'life_insurance') {
      deathBenefit += value
      lifeInsuranceFace += faceValue(asset)
    } else {
      ownedAssetValue += value
    }
    if (asset.category === 'business') businessInterests += value
    if (asset.category === 'inheritance') anticipatedInheritance += value
    totalDebt += assetDebt(asset)

    if (
      asset.updated_at
      && (!latestAssetUpdatedAt || Date.parse(asset.updated_at) > Date.parse(latestAssetUpdatedAt))
    ) {
      latestAssetUpdatedAt = asset.updated_at
    }
  }

  const grossEstateEstimate = ownedAssetValue + deathBenefit
  const estimatedMaTax = calculateMAEstateTax(grossEstateEstimate)
  const maTaxWithCreditShelter = calculateMAEstateTaxWithCreditShelter(grossEstateEstimate)

  return {
    assetCount: assets.length,
    ownedAssetValue,
    deathBenefit,
    lifeInsuranceFace,
    businessInterests,
    anticipatedInheritance,
    grossEstateEstimate,
    estateExcludingLifeInsurance: Math.max(0, grossEstateEstimate - lifeInsuranceFace),
    totalDebt,
    netInventoryValue: Math.max(0, grossEstateEstimate - totalDebt),
    estimatedMaTax,
    maTaxWithCreditShelter,
    creditShelterSavings: Math.max(0, estimatedMaTax - maTaxWithCreditShelter),
    latestAssetUpdatedAt,
  }
}

export const EMPTY_MATTER_ESTATE_SNAPSHOT: MatterEstateSnapshot = {
  assetCount: 0,
  ownedAssetValue: 0,
  deathBenefit: 0,
  lifeInsuranceFace: 0,
  businessInterests: 0,
  anticipatedInheritance: 0,
  grossEstateEstimate: 0,
  estateExcludingLifeInsurance: 0,
  totalDebt: 0,
  netInventoryValue: 0,
  estimatedMaTax: 0,
  maTaxWithCreditShelter: 0,
  creditShelterSavings: 0,
  latestAssetUpdatedAt: null,
}
