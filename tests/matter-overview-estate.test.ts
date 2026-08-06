import { describe, expect, it } from 'vitest'
import {
  computeMatterEstateSnapshot,
  type MatterEstateAsset,
} from '@/lib/assets/matterEstateSnapshot'

function asset(overrides: Partial<MatterEstateAsset> = {}): MatterEstateAsset {
  return {
    category: 'bank',
    value: 100_000,
    details: {},
    updated_at: '2026-07-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('matter estate snapshot', () => {
  it('returns a zeroed snapshot for an empty inventory', () => {
    expect(computeMatterEstateSnapshot([])).toEqual({
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
    })
  })

  it('tracks life insurance face, business interests and anticipated inheritance', () => {
    const snapshot = computeMatterEstateSnapshot([
      asset({ category: 'life_insurance', value: 500_000, details: { face_value: 2_000_000 } }),
      asset({ category: 'business', value: 900_000 }),
      asset({ category: 'inheritance', value: 250_000 }),
    ])

    expect(snapshot.lifeInsuranceFace).toBe(2_000_000)
    expect(snapshot.businessInterests).toBe(900_000)
    expect(snapshot.anticipatedInheritance).toBe(250_000)
    // Face value is reported beside the estate, never netted out of the tax base.
    expect(snapshot.grossEstateEstimate).toBe(1_650_000)
    expect(snapshot.estateExcludingLifeInsurance).toBe(0)
  })

  it('quantifies what a credit shelter saves on a taxable estate', () => {
    const snapshot = computeMatterEstateSnapshot([asset({ category: 'bank', value: 4_000_000 })])

    expect(snapshot.estimatedMaTax).toBeGreaterThan(0)
    expect(snapshot.maTaxWithCreditShelter).toBeLessThan(snapshot.estimatedMaTax)
    expect(snapshot.creditShelterSavings).toBe(
      snapshot.estimatedMaTax - snapshot.maTaxWithCreditShelter,
    )
  })

  it('leaves an estate under the exemption with nothing to save', () => {
    const snapshot = computeMatterEstateSnapshot([asset({ category: 'bank', value: 900_000 })])

    expect(snapshot.estimatedMaTax).toBe(0)
    expect(snapshot.creditShelterSavings).toBe(0)
  })

  it('separates death benefits while including them in the conservative estate estimate', () => {
    const snapshot = computeMatterEstateSnapshot([
      asset({ category: 'bank', value: 400_000 }),
      asset({
        category: 'real_estate',
        value: 800_000,
        details: { mortgage_balance: 200_000 },
        updated_at: '2026-07-21T12:00:00.000Z',
      }),
      asset({
        category: 'life_insurance',
        value: 2_000_000,
        updated_at: '2026-07-22T12:00:00.000Z',
      }),
    ])

    expect(snapshot.assetCount).toBe(3)
    expect(snapshot.ownedAssetValue).toBe(1_200_000)
    expect(snapshot.deathBenefit).toBe(2_000_000)
    expect(snapshot.grossEstateEstimate).toBe(3_200_000)
    expect(snapshot.totalDebt).toBe(200_000)
    expect(snapshot.netInventoryValue).toBe(3_000_000)
    expect(snapshot.estimatedMaTax).toBeGreaterThan(0)
    expect(snapshot.latestAssetUpdatedAt).toBe('2026-07-22T12:00:00.000Z')
  })
})
