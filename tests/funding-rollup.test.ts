import { describe, expect, it } from 'vitest'
import { summariseMatters, toFundingAssets } from '@/lib/funding/rollup'

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  matter_id: 'm-1',
  matter_title: 'Smith Revocable Trust',
  matter_stage: 'funding',
  asset_id: 'a-1',
  category: 'bank',
  description: 'Checking',
  ownership: 'client',
  value: 1000,
  method: null,
  status: null,
  confirmed_on: null,
  note: null,
  ...over,
})

/**
 * An asset with no funding row has not been looked at yet, which is different
 * from having been looked at and found not to need anything. It reads as
 * not_started, and its default method comes from its category.
 */
describe('toFundingAssets', () => {
  it('treats an asset with no funding row as not started', () => {
    const [asset] = toFundingAssets([row()])
    expect(asset.status).toBe('not_started')
    expect(asset.method).toBe('retitle')
    expect(asset.isRecorded).toBe(false)
  })

  it('suggests the method for the category when none is recorded', () => {
    expect(toFundingAssets([row({ category: 'retirement' })])[0].method).toBe('beneficiary')
    expect(toFundingAssets([row({ category: 'real_estate' })])[0].method).toBe('deed')
  })

  it('uses the recorded method and status when there is one', () => {
    const [asset] = toFundingAssets([
      row({ method: 'beneficiary', status: 'confirmed', confirmed_on: '2026-08-12' }),
    ])
    expect(asset).toMatchObject({ method: 'beneficiary', status: 'confirmed', confirmedOn: '2026-08-12', isRecorded: true })
  })

  it('falls back to not_started for a status the app does not know', () => {
    // A value written by something older than this code must not crash a page.
    expect(toFundingAssets([row({ status: 'teleported' })])[0].status).toBe('not_started')
  })
})

describe('summariseMatters', () => {
  it('gives each matter its own unfunded figure', () => {
    const summaries = summariseMatters([
      row({ matter_id: 'm-1', asset_id: 'a-1', value: 500_000 }),
      row({ matter_id: 'm-1', asset_id: 'a-2', value: 100_000, status: 'confirmed' }),
      row({ matter_id: 'm-2', matter_title: 'Jones Trust', asset_id: 'a-3', value: 20_000 }),
    ])
    expect(summaries).toHaveLength(2)
    expect(summaries.find((s) => s.matterId === 'm-1')?.summary.unfundedValue).toBe(500_000)
    expect(summaries.find((s) => s.matterId === 'm-2')?.summary.unfundedValue).toBe(20_000)
  })

  /**
   * The worklist is ordered by exposure, because that is the question it
   * answers: which client is most at risk right now.
   */
  it('puts the most exposed matter first', () => {
    const summaries = summariseMatters([
      row({ matter_id: 'small', asset_id: 'a-1', value: 5_000 }),
      row({ matter_id: 'large', asset_id: 'a-2', value: 900_000 }),
    ])
    expect(summaries.map((s) => s.matterId)).toEqual(['large', 'small'])
  })

  it('keeps a fully funded matter, so it can be seen as done', () => {
    const summaries = summariseMatters([row({ status: 'confirmed', confirmed_on: '2026-08-01' })])
    expect(summaries[0].summary.isComplete).toBe(true)
    expect(summaries[0].summary.unfundedValue).toBe(0)
  })

  it('carries the matter title and stage through for display', () => {
    const [summary] = summariseMatters([row()])
    expect(summary).toMatchObject({ title: 'Smith Revocable Trust', stage: 'funding' })
  })

  it('returns nothing for no rows', () => {
    expect(summariseMatters([])).toEqual([])
  })
})
