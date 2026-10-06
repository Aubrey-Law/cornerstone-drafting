import { describe, expect, it } from 'vitest'
import { computePaycheck, computeRegister, federalDepositDue } from '@/lib/payroll/calc'
import { defaultSettings } from '@/lib/payroll/defaults'
import { mulDivRound, parseDollarsToCents, rateToMicros } from '@/lib/payroll/money'
import type { PayrollRunInput, PayrollSettings } from '@/lib/payroll/types'

const settings = (overrides: Partial<PayrollSettings> = {}): PayrollSettings => ({
  ...defaultSettings(2026),
  fedWhPerCheckCents: 70_000,
  ...overrides,
})

const run = (id: string, payDate: string, grossCents: number, extra: Partial<PayrollRunInput> = {}): PayrollRunInput => ({
  id, payDate, grossCents, fedWhOverrideCents: null, status: 'draft', computed: null, ...extra,
})

describe('computePaycheck', () => {
  it('matches the workbook example: $5,000 monthly with $700 federal withholding', () => {
    const p = computePaycheck(settings(), 0, { payDate: '2026-10-30', grossCents: 500_000 })
    expect(p).toMatchObject({
      quarter: 4,
      fedWhCents: 70_000,
      ssEeCents: 31_000,
      medicareEeCents: 7_250,
      maWhCents: 23_167,
      pfmlEeCents: 2_300,
      totalWithholdingCents: 133_717,
      netCents: 366_283,
      ssErCents: 31_000,
      medicareErCents: 7_250,
      futaCents: 3_000,
      maUiCents: 12_380,
      pfmlErCents: 0,
      totalEmployerCents: 53_630,
      totalCostCents: 553_630,
      fedDepositDue: '2026-11-15',
    })
  })

  it('uses a per-run federal withholding override', () => {
    const p = computePaycheck(settings(), 0, { payDate: '2026-01-31', grossCents: 500_000, fedWhOverrideCents: 12_345 })
    expect(p.fedWhCents).toBe(12_345)
  })

  it('caps Social Security and PFML at the wage base when a check crosses it', () => {
    // $184,500 base; $180,000 already paid; this $10,000 check has $4,500 under the base.
    const p = computePaycheck(settings(), 18_000_000, { payDate: '2026-12-31', grossCents: 1_000_000 })
    expect(p.ssEeCents).toBe(27_900) // 4,500 × 6.2%
    expect(p.ssErCents).toBe(27_900)
    expect(p.pfmlEeCents).toBe(2_070) // 4,500 × 0.46%
    expect(p.futaCents).toBe(0)
    expect(p.maUiCents).toBe(0)
  })

  it('charges Additional Medicare only on the slice above $200,000', () => {
    // $195,000 before; $10,000 check; $5,000 above the threshold.
    const p = computePaycheck(settings(), 19_500_000, { payDate: '2026-12-31', grossCents: 1_000_000 })
    expect(p.medicareEeCents).toBe(14_500 + 4_500)
    expect(p.medicareErCents).toBe(14_500)
  })

  it('stops FUTA and MA UI once their small wage bases are reached', () => {
    const p = computePaycheck(settings(), 500_000, { payDate: '2026-02-28', grossCents: 1_200_000 })
    expect(p.futaCents).toBe(1_200) // 2,000 × 0.6%
    expect(p.maUiCents).toBe(24_760) // 10,000 × 2.476%
  })

  it('never withholds negative MA tax on a check smaller than the per-period exemption', () => {
    const p = computePaycheck(settings(), 0, { payDate: '2026-01-31', grossCents: 30_000 })
    expect(p.maWhCents).toBe(0)
  })

  it('rolls the December deposit into January of the next year', () => {
    expect(federalDepositDue('2026-12-31')).toBe('2027-01-15')
  })
})

describe('computeRegister', () => {
  it('builds YTD from prior wages and earlier runs in pay-date order', () => {
    const rows = computeRegister(settings({ priorWagesCents: 600_000 }), [
      run('b', '2026-02-28', 500_000),
      run('a', '2026-01-31', 500_000),
    ])
    expect(rows.map(r => [r.period, r.payDate, r.paycheck.ytdBeforeCents])).toEqual([
      [1, '2026-01-31', 600_000],
      [2, '2026-02-28', 1_100_000],
    ])
    // FUTA base of $7,000 is partly used by prior wages: 1,000 × 0.6% on the first run, nothing after.
    expect(rows[0].paycheck.futaCents).toBe(600)
    expect(rows[1].paycheck.futaCents).toBe(0)
  })

  it('keeps a finalized snapshot when the rates change later, and flags the drift', () => {
    const original = computePaycheck(settings(), 0, { payDate: '2026-01-31', grossCents: 500_000 })
    const changed = settings({ maUiRateMicros: 30_000 })
    const rows = computeRegister(changed, [
      run('a', '2026-01-31', 500_000, { status: 'finalized', computed: original }),
      run('b', '2026-02-28', 500_000),
    ])
    expect(rows[0].paycheck.maUiCents).toBe(original.maUiCents)
    expect(rows[0].driftsFromSettings).toBe(true)
    expect(rows[1].paycheck.maUiCents).toBe(15_280) // 5,000 × 3.056%
  })

  it('recomputes a whole 2026 year of $15,000 monthly checks with every cap reached once', () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      run(String(i), `2026-${String(i + 1).padStart(2, '0')}-28`, 1_500_000))
    const rows = computeRegister(settings(), runs)
    const sum = (key: 'ssEeCents' | 'futaCents' | 'maUiCents' | 'pfmlEeCents' | 'medicareEeCents') =>
      rows.reduce((total, row) => total + row.paycheck[key], 0)
    expect(sum('futaCents')).toBe(4_200) // $7,000 × 0.6%
    expect(sum('maUiCents')).toBe(37_140) // $15,000 × 2.476%
    expect(sum('ssEeCents')).toBe(1_116_000) // $180,000 × 6.2% (under the base)
    expect(sum('pfmlEeCents')).toBe(82_800)
    expect(sum('medicareEeCents')).toBe(261_000) // $180,000 × 1.45%, no Additional Medicare
  })
})

describe('money helpers', () => {
  it('rounds half up exactly where floating point would not', () => {
    expect(mulDivRound(1_005, 1, 10)).toBe(101)
    expect(mulDivRound(4_600, 5, 10_000)).toBe(2)
    expect(rateToMicros('0.00056')).toBe(560)
  })

  it('parses typed dollar amounts', () => {
    expect(parseDollarsToCents('$5,000')).toBe(500_000)
    expect(parseDollarsToCents('12.5')).toBe(1_250)
    expect(parseDollarsToCents('12.345')).toBeNull()
    expect(parseDollarsToCents('-1')).toBeNull()
  })
})

/**
 * A 2026 year recalculated by LibreOffice from the firm's Payroll_System.xlsx
 * (Register columns D–S), with $700 federal withholding and default rates. It
 * crosses the Social Security base, the Additional Medicare threshold, and the
 * FUTA and MA UI bases, and includes odd-cent wages.
 */
const WORKBOOK_COLUMNS = ['grossCents', 'fedWhCents', 'ssEeCents', 'medicareEeCents', 'maWhCents', 'pfmlEeCents',
  'totalWithholdingCents', 'netCents', 'ssErCents', 'medicareErCents', 'futaCents', 'maUiCents', 'pfmlErCents',
  'totalEmployerCents', 'totalCostCents'] as const
const WORKBOOK_ROWS: number[][] = [
  [512345, 70000, 31765, 7429, 23784, 2357, 135335, 377010, 31765, 7429, 3074, 12686, 0, 54954, 567299],
  [2500000, 70000, 155000, 36250, 123167, 11500, 395917, 2104083, 155000, 36250, 1126, 24454, 0, 216830, 2716830],
  [2500000, 70000, 155000, 36250, 123167, 11500, 395917, 2104083, 155000, 36250, 0, 0, 0, 191250, 2691250],
  [3123457, 70000, 193654, 45290, 154340, 14368, 477652, 2645805, 193654, 45290, 0, 0, 0, 238944, 3362401],
  [2500000, 70000, 155000, 36250, 123167, 11500, 395917, 2104083, 155000, 36250, 0, 0, 0, 191250, 2691250],
  [2500000, 70000, 155000, 36250, 123167, 11500, 395917, 2104083, 155000, 36250, 0, 0, 0, 191250, 2691250],
  [2500000, 70000, 155000, 36250, 123167, 11500, 395917, 2104083, 155000, 36250, 0, 0, 0, 191250, 2691250],
  [2500000, 70000, 143480, 36250, 123167, 10645, 383542, 2116458, 143480, 36250, 0, 0, 0, 179730, 2679730],
  [4000000, 70000, 0, 81722, 198167, 0, 349889, 3650111, 0, 58000, 0, 0, 0, 58000, 4058000],
  [100000, 70000, 0, 2350, 3167, 0, 75517, 24483, 0, 1450, 0, 0, 0, 1450, 101450],
  [2500000, 70000, 0, 58750, 123167, 0, 251917, 2248083, 0, 36250, 0, 0, 0, 36250, 2536250],
  [1876543, 70000, 0, 44099, 91994, 0, 206093, 1670450, 0, 27210, 0, 0, 0, 27210, 1903753],
]

describe('workbook cross-check', () => {
  it('reproduces every Register figure for a full year', () => {
    const rows = computeRegister(settings(), WORKBOOK_ROWS.map((values, i) =>
      run(String(i), `2026-${String(i + 1).padStart(2, '0')}-28`, values[0])))
    expect(rows.map(row => WORKBOOK_COLUMNS.map(key => row.paycheck[key]))).toEqual(WORKBOOK_ROWS)
  })
})
