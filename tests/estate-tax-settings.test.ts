import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BUNDLED_SCHEDULES,
  estateTaxSchedulesSchema,
  loadEstateTaxSchedules,
  mergeSchedules,
} from '@/lib/estateTaxSettings'
import { federalScheduleAsOf } from '@/lib/estateTax'
import { FEDERAL_SCHEDULE_2025 } from '@/lib/estateTaxSchedules'

const FEDERAL_2026 = {
  jurisdiction: 'US' as const,
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  source: 'IRC §2010(c) basic exclusion amount, 2026',
  exemption: 15_000_000,
  rate: 0.4,
}

function adminReturning(value: unknown, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: error ? null : { estate_tax_schedules: value },
            error,
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient
}

describe('estate tax schedule validation', () => {
  it('accepts a well-formed federal schedule', () => {
    expect(estateTaxSchedulesSchema.safeParse([FEDERAL_2026]).success).toBe(true)
  })

  it('requires a source, so a figure can always be checked against an authority', () => {
    const parsed = estateTaxSchedulesSchema.safeParse([{ ...FEDERAL_2026, source: '' }])
    expect(parsed.success).toBe(false)
  })

  it('rejects a malformed effective date', () => {
    const parsed = estateTaxSchedulesSchema.safeParse([{ ...FEDERAL_2026, effectiveFrom: 'Jan 2026' }])
    expect(parsed.success).toBe(false)
  })

  it('rejects a rate outside 0–1, catching a percentage entered as 40', () => {
    expect(estateTaxSchedulesSchema.safeParse([{ ...FEDERAL_2026, rate: 40 }]).success).toBe(false)
  })
})

describe('merging configured schedules over bundled ones', () => {
  /**
   * The case the whole column exists for: this year's federal exclusion,
   * entered by the attorney, without waiting for a deploy.
   */
  it('adds a year the bundled data does not have', () => {
    const merged = mergeSchedules([FEDERAL_2026])
    const found = federalScheduleAsOf('2026-06-01', merged.federal)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.schedule.exemption).toBe(15_000_000)
  })

  /**
   * Replacing rather than appending matters: two schedules covering one date
   * would leave the resolver choosing between them, so a correction has to
   * overwrite the row it corrects.
   */
  it('replaces a bundled schedule with the same effective date', () => {
    const corrected = { ...FEDERAL_SCHEDULE_2025, exemption: 13_610_000, source: 'corrected' }
    const merged = mergeSchedules([corrected])
    expect(merged.federal).toHaveLength(BUNDLED_SCHEDULES.federal.length)
    const found = federalScheduleAsOf('2025-06-01', merged.federal)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.schedule.exemption).toBe(13_610_000)
  })

  it('keeps the two jurisdictions apart', () => {
    const merged = mergeSchedules([FEDERAL_2026])
    expect(merged.massachusetts).toEqual(BUNDLED_SCHEDULES.massachusetts)
    expect(merged.federal.every(s => s.jurisdiction === 'US')).toBe(true)
  })
})

describe('loading schedules', () => {
  it('uses the bundled figures when nothing is configured', async () => {
    const { schedules, errors } = await loadEstateTaxSchedules(adminReturning([]))
    expect(errors).toEqual([])
    expect(schedules).toEqual(BUNDLED_SCHEDULES)
  })

  it('applies what is configured', async () => {
    const { schedules, errors } = await loadEstateTaxSchedules(adminReturning([FEDERAL_2026]))
    expect(errors).toEqual([])
    expect(federalScheduleAsOf('2026-06-01', schedules.federal).ok).toBe(true)
  })

  /**
   * Bad configuration must not take down every page that shows an estate
   * figure — but it must not vanish either. Someone who entered a figure needs
   * to learn it was never applied.
   */
  it('falls back and reports why when the stored JSON is malformed', async () => {
    const { schedules, errors } = await loadEstateTaxSchedules(
      adminReturning([{ jurisdiction: 'US', exemption: 'lots' }]),
    )
    expect(schedules).toEqual(BUNDLED_SCHEDULES)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('falls back and reports the error when the query fails', async () => {
    const { schedules, errors } = await loadEstateTaxSchedules(
      adminReturning(null, { message: 'connection reset' }),
    )
    expect(schedules).toEqual(BUNDLED_SCHEDULES)
    expect(errors).toEqual(['connection reset'])
  })
})
