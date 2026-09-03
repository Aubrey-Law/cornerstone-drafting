import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveEstateTaxSchedules, type EstateTaxScheduleInput } from '@/lib/estateTaxSettings'

function federal(year: number, overrides: Partial<EstateTaxScheduleInput> = {}) {
  return {
    jurisdiction: 'US' as const,
    effectiveFrom: `${year}-01-01`,
    effectiveTo: `${year}-12-31`,
    source: `Rev. Proc. for ${year}`,
    exemption: 15_000_000,
    rate: 0.4,
    ...overrides,
  }
}

function adminCapturing(captured: { value?: unknown }, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      update: vi.fn((row: Record<string, unknown>) => {
        captured.value = row.estate_tax_schedules
        return { eq: vi.fn(async () => ({ error })) }
      }),
    })),
  } as unknown as SupabaseClient
}

describe('saving estate tax schedules', () => {
  it('writes valid schedules', async () => {
    const captured: { value?: unknown } = {}
    const result = await saveEstateTaxSchedules(adminCapturing(captured), [federal(2026)], 'user-1')
    expect(result.ok).toBe(true)
    expect(captured.value).toEqual([federal(2026)])
  })

  it('refuses a figure with no source', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}),
      [federal(2026, { source: '' })],
      'user-1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/authority/i)
  })

  /**
   * The resolver picks the latest `effectiveFrom` among matching schedules, so
   * an overlap does not throw — it silently prefers one figure over another,
   * and which one is a detail of the sort order rather than a decision anybody
   * made. Refusing the save is the only place this can be caught honestly.
   */
  it('refuses two schedules covering the same date, naming both', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}),
      [federal(2026), federal(2026, { effectiveFrom: '2026-06-01', effectiveTo: '2027-06-01' })],
      'user-1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('2026-06-01')
    expect(result.errors[0]).toContain('2026-01-01')
  })

  it('refuses an open-ended schedule followed by a later one', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}),
      [federal(2026, { effectiveTo: null }), federal(2027)],
      'user-1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/has not ended/)
  })

  it('refuses a window that ends before it begins', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}),
      [federal(2026, { effectiveTo: '2025-12-31' })],
      'user-1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/ends before it begins/)
  })

  it('allows consecutive years that do not overlap', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}),
      [federal(2026), federal(2027), federal(2028)],
      'user-1',
    )
    expect(result.ok).toBe(true)
  })

  it('checks the two jurisdictions independently', async () => {
    const ma = {
      jurisdiction: 'MA' as const,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      source: 'MGL Ch. 65C',
      exemption: 2_000_000,
      credit: 99_600,
      adjustment: 60_000,
      brackets: [{ from: 0, upTo: null, base: 0, rate: 0.1 }],
    }
    // Same window as the federal row, but a different jurisdiction — not a clash.
    const result = await saveEstateTaxSchedules(adminCapturing({}), [federal(2026), ma], 'user-1')
    expect(result.ok).toBe(true)
  })

  it('reports a write failure rather than claiming success', async () => {
    const result = await saveEstateTaxSchedules(
      adminCapturing({}, { message: 'permission denied' }),
      [federal(2026)],
      'user-1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual(['permission denied'])
  })
})
