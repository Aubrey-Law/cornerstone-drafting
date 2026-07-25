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
      grossEstateEstimate: 0,
      totalDebt: 0,
      netInventoryValue: 0,
      estimatedMaTax: 0,
      latestAssetUpdatedAt: null,
    })
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
