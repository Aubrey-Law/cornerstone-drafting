import { describe, expect, it } from 'vitest'
import {
  BUNDLED_FEDERAL_SCHEDULES,
  BUNDLED_MA_SCHEDULES,
  FEDERAL_SCHEDULE_2025,
  MA_SCHEDULE_2023,
  federalEstateTax,
  massachusettsEstateTax,
  massachusettsEstateTaxWithCreditShelter,
  resolveScheduleAsOf,
  tentativeTax,
  todayIso,
} from '@/lib/estateTaxSchedules'

/**
 * The table this replaced, transcribed verbatim from the version of
 * lib/estateTax.ts that hard-coded it. Kept here as the oracle: the point of
 * the change was to move the figures into dated data, not to alter a single
 * dollar of the arithmetic.
 */
function legacyTentativeTax(adj: number): number {
  if (adj <= 40000) return 0
  if (adj <= 90000) return (adj - 40000) * 0.008
  if (adj <= 140000) return 400 + (adj - 90000) * 0.016
  if (adj <= 240000) return 1200 + (adj - 140000) * 0.024
  if (adj <= 440000) return 3600 + (adj - 240000) * 0.032
  if (adj <= 640000) return 10000 + (adj - 440000) * 0.04
  if (adj <= 840000) return 18000 + (adj - 640000) * 0.048
  if (adj <= 1040000) return 27600 + (adj - 840000) * 0.056
  if (adj <= 1540000) return 38800 + (adj - 1040000) * 0.064
  if (adj <= 2040000) return 70800 + (adj - 1540000) * 0.072
  if (adj <= 2540000) return 106800 + (adj - 2040000) * 0.08
  if (adj <= 3040000) return 146800 + (adj - 2540000) * 0.088
  if (adj <= 3540000) return 190800 + (adj - 3040000) * 0.096
  if (adj <= 4040000) return 238800 + (adj - 3540000) * 0.104
  if (adj <= 5040000) return 290800 + (adj - 4040000) * 0.112
  if (adj <= 6040000) return 402800 + (adj - 5040000) * 0.12
  if (adj <= 7040000) return 522800 + (adj - 6040000) * 0.128
  if (adj <= 8040000) return 650800 + (adj - 7040000) * 0.136
  if (adj <= 9040000) return 786800 + (adj - 8040000) * 0.144
  if (adj <= 10040000) return 930800 + (adj - 9040000) * 0.152
  return 1082800 + (adj - 10040000) * 0.16
}

describe('Massachusetts bracket table', () => {
  /**
   * A transcription of 21 brackets is exactly the kind of change that looks
   * right and is wrong in one row. Sweeping both implementations against each
   * other — including every boundary and one dollar either side of it — is the
   * only check that actually proves the move changed no arithmetic.
   */
  it('reproduces the table it replaced, dollar for dollar', () => {
    const boundaries = MA_SCHEDULE_2023.brackets.flatMap(bracket =>
      bracket.upTo === null ? [bracket.from] : [bracket.from, bracket.upTo],
    )
    const probes = new Set<number>([0, 1, 39_999, 12_345_678, 50_000_000])
    for (const boundary of boundaries) {
      probes.add(boundary - 1)
      probes.add(boundary)
      probes.add(boundary + 1)
    }
    for (let value = 0; value <= 12_000_000; value += 7_919) probes.add(value)

    for (const value of probes) {
      if (value < 0) continue
      expect(tentativeTax(value, MA_SCHEDULE_2023.brackets)).toBeCloseTo(
        legacyTentativeTax(value),
        6,
      )
    }
  })

  it('covers the number line with no gap or overlap between brackets', () => {
    const brackets = MA_SCHEDULE_2023.brackets
    expect(brackets[0].from).toBe(0)
    for (let i = 1; i < brackets.length; i += 1) {
      expect(brackets[i].from).toBe(brackets[i - 1].upTo)
    }
    expect(brackets[brackets.length - 1].upTo).toBeNull()
  })

  it('is continuous at every boundary — each base equals the tax up to it', () => {
    for (const bracket of MA_SCHEDULE_2023.brackets) {
      expect(tentativeTax(bracket.from, MA_SCHEDULE_2023.brackets)).toBeCloseTo(bracket.base, 6)
    }
  })
})

describe('Massachusetts tax', () => {
  it('is zero below the exemption and positive above it', () => {
    expect(massachusettsEstateTax(1_500_000, MA_SCHEDULE_2023)).toBe(0)
    expect(massachusettsEstateTax(MA_SCHEDULE_2023.exemption, MA_SCHEDULE_2023)).toBe(0)
    expect(massachusettsEstateTax(2_500_000, MA_SCHEDULE_2023)).toBeGreaterThan(0)
  })

  it('shelters one exemption under a two-trust plan', () => {
    const gross = 4_000_000
    expect(massachusettsEstateTaxWithCreditShelter(gross, MA_SCHEDULE_2023)).toBe(
      massachusettsEstateTax(gross - MA_SCHEDULE_2023.exemption, MA_SCHEDULE_2023),
    )
    expect(massachusettsEstateTaxWithCreditShelter(gross, MA_SCHEDULE_2023)).toBeLessThan(
      massachusettsEstateTax(gross, MA_SCHEDULE_2023),
    )
  })
})

describe('federal tax', () => {
  it('doubles the exclusion for a married couple', () => {
    const gross = 20_000_000
    expect(federalEstateTax(gross, FEDERAL_SCHEDULE_2025, { married: true })).toBeLessThan(
      federalEstateTax(gross, FEDERAL_SCHEDULE_2025),
    )
    expect(federalEstateTax(FEDERAL_SCHEDULE_2025.exemption * 2, FEDERAL_SCHEDULE_2025, { married: true })).toBe(0)
  })
})

describe('resolving a schedule by date', () => {
  it('finds the schedule in force on a date inside its window', () => {
    const found = resolveScheduleAsOf(BUNDLED_FEDERAL_SCHEDULES, '2025-06-30')
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.schedule.exemption).toBe(13_990_000)
  })

  it('includes both endpoints of the window', () => {
    expect(resolveScheduleAsOf(BUNDLED_FEDERAL_SCHEDULES, '2025-01-01').ok).toBe(true)
    expect(resolveScheduleAsOf(BUNDLED_FEDERAL_SCHEDULES, '2025-12-31').ok).toBe(true)
  })

  /**
   * The behaviour this whole module exists for. The federal exclusion is
   * indexed and changes most years, so the 2025 window is closed — and asking
   * for 2026 has to report that the firm has no figure on file rather than
   * quietly handing back last year's number, which is what the old constant did
   * forever.
   */
  it('refuses a date past the end of the window instead of using the last figure', () => {
    const found = resolveScheduleAsOf(BUNDLED_FEDERAL_SCHEDULES, '2026-01-01')
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.reason).toBe('none_on_file')
    expect(found.asOf).toBe('2026-01-01')
    // Carried so a caller can say how stale the data is — not as a fallback.
    expect(found.mostRecent?.effectiveFrom).toBe('2025-01-01')
  })

  it('refuses a date before any schedule begins', () => {
    const found = resolveScheduleAsOf(BUNDLED_MA_SCHEDULES, '2019-01-01')
    expect(found.ok).toBe(false)
  })

  it('picks the latest schedule when windows overlap', () => {
    const older = { ...FEDERAL_SCHEDULE_2025, effectiveTo: null }
    const newer = {
      ...FEDERAL_SCHEDULE_2025,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      exemption: 99_000_000,
    }
    const found = resolveScheduleAsOf([older, newer], '2026-05-05')
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.schedule.exemption).toBe(99_000_000)
  })

  it('reports a miss rather than throwing when nothing is on file at all', () => {
    const found = resolveScheduleAsOf<typeof FEDERAL_SCHEDULE_2025>([], '2026-01-01')
    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.mostRecent).toBeNull()
  })

  it('the Massachusetts schedule is open-ended and still applies today', () => {
    expect(resolveScheduleAsOf(BUNDLED_MA_SCHEDULES, todayIso()).ok).toBe(true)
  })
})

describe('todayIso', () => {
  it('formats a local date, not a UTC one', () => {
    // Late evening on the 31st in a negative-offset zone is still the 31st.
    expect(todayIso(new Date(2026, 0, 31, 23, 30))).toBe('2026-01-31')
    expect(todayIso(new Date(2026, 8, 3))).toBe('2026-09-03')
  })
})
