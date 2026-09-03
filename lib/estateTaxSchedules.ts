/**
 * Estate tax figures as dated data rather than constants in code.
 *
 * The defect this replaces: `lib/estateTax.ts` hard-coded the entire
 * Massachusetts rate table with the exemption in a comment and **no effective
 * date anywhere**, and the federal exclusion as a bare number labelled "2025
 * figure". Nothing marked either stale when the law moved. A figure that is
 * silently a year out of date is worse than a missing one, because a stale
 * exemption quoted to a client reads exactly like a current one.
 *
 * So every figure now carries the window it applies to and the authority it
 * came from, and asking for a date nothing covers returns **"not on file"**
 * rather than the nearest number. That refusal is the point: a schedule the
 * firm has not entered is a question for the attorney, not something to
 * approximate.
 */

export interface EstateTaxBracket {
  /** Inclusive lower bound of the bracket, in dollars of adjusted estate. */
  from: number
  /** Exclusive upper bound; null means the top bracket runs without limit. */
  upTo: number | null
  /** Cumulative tax at `from`. */
  base: number
  /** Marginal rate applied to the amount above `from`. */
  rate: number
}

interface ScheduleWindow {
  /** ISO date the schedule takes effect, inclusive. */
  effectiveFrom: string
  /** ISO date it stops applying, inclusive. Null means still in force. */
  effectiveTo: string | null
  /** The authority this came from, so a reader can check it. */
  source: string
}

export interface MassachusettsEstateTaxSchedule extends ScheduleWindow {
  jurisdiction: 'MA'
  /** Estate value at which the credit stops covering the tentative tax. */
  exemption: number
  /** Credit subtracted from the tentative tax. */
  credit: number
  /** Subtracted from the gross estate before the table is applied. */
  adjustment: number
  brackets: EstateTaxBracket[]
}

export interface FederalEstateTaxSchedule extends ScheduleWindow {
  jurisdiction: 'US'
  /** Basic exclusion amount. Indexed, so this changes most years. */
  exemption: number
  /** Flat rate above the exclusion. */
  rate: number
}

export type EstateTaxSchedule = MassachusettsEstateTaxSchedule | FederalEstateTaxSchedule

/**
 * What a lookup found, or did not.
 *
 * `mostRecent` is carried on a miss so a caller can say *how* stale the firm's
 * data is — "the newest figure on file is from 2025" is a far more useful thing
 * to show than "unavailable". It is deliberately not a fallback value: nothing
 * here decides to use it on the caller's behalf.
 */
export type ScheduleLookup<T extends EstateTaxSchedule> =
  | { ok: true; schedule: T }
  | { ok: false; reason: 'none_on_file'; asOf: string; mostRecent: T | null }

/**
 * Massachusetts, as amended by H.4104 effective 1 January 2023.
 *
 * The brackets reproduce the table this replaced exactly — a test sweeps both
 * against each other rather than trusting the transcription.
 */
export const MA_SCHEDULE_2023: MassachusettsEstateTaxSchedule = {
  jurisdiction: 'MA',
  effectiveFrom: '2023-01-01',
  effectiveTo: null,
  source: 'MGL Ch. 65C, as amended by H.4104 (effective Jan 1, 2023)',
  exemption: 2_000_000,
  credit: 99_600,
  adjustment: 60_000,
  brackets: [
    { from: 0, upTo: 40_000, base: 0, rate: 0 },
    { from: 40_000, upTo: 90_000, base: 0, rate: 0.008 },
    { from: 90_000, upTo: 140_000, base: 400, rate: 0.016 },
    { from: 140_000, upTo: 240_000, base: 1_200, rate: 0.024 },
    { from: 240_000, upTo: 440_000, base: 3_600, rate: 0.032 },
    { from: 440_000, upTo: 640_000, base: 10_000, rate: 0.04 },
    { from: 640_000, upTo: 840_000, base: 18_000, rate: 0.048 },
    { from: 840_000, upTo: 1_040_000, base: 27_600, rate: 0.056 },
    { from: 1_040_000, upTo: 1_540_000, base: 38_800, rate: 0.064 },
    { from: 1_540_000, upTo: 2_040_000, base: 70_800, rate: 0.072 },
    { from: 2_040_000, upTo: 2_540_000, base: 106_800, rate: 0.08 },
    { from: 2_540_000, upTo: 3_040_000, base: 146_800, rate: 0.088 },
    { from: 3_040_000, upTo: 3_540_000, base: 190_800, rate: 0.096 },
    { from: 3_540_000, upTo: 4_040_000, base: 238_800, rate: 0.104 },
    { from: 4_040_000, upTo: 5_040_000, base: 290_800, rate: 0.112 },
    { from: 5_040_000, upTo: 6_040_000, base: 402_800, rate: 0.12 },
    { from: 6_040_000, upTo: 7_040_000, base: 522_800, rate: 0.128 },
    { from: 7_040_000, upTo: 8_040_000, base: 650_800, rate: 0.136 },
    { from: 8_040_000, upTo: 9_040_000, base: 786_800, rate: 0.144 },
    { from: 9_040_000, upTo: 10_040_000, base: 930_800, rate: 0.152 },
    { from: 10_040_000, upTo: null, base: 1_082_800, rate: 0.16 },
  ],
}

/**
 * Federal, 2025.
 *
 * **Deliberately closed at 2025-12-31.** The basic exclusion amount is indexed
 * and changes most years, so an open-ended window would quietly keep quoting
 * this figure forever — which is exactly how the old constant behaved. Closing
 * it means a lookup for any later date reports that the firm has no figure on
 * file, and the attorney enters the current one rather than the app inventing
 * it. Adding next year's figure is a row in `firm_settings`, not a deploy.
 */
export const FEDERAL_SCHEDULE_2025: FederalEstateTaxSchedule = {
  jurisdiction: 'US',
  effectiveFrom: '2025-01-01',
  effectiveTo: '2025-12-31',
  source: 'IRC §2010(c) basic exclusion amount, 2025 (Rev. Proc. 2024-40)',
  exemption: 13_990_000,
  rate: 0.4,
}

export const BUNDLED_MA_SCHEDULES: MassachusettsEstateTaxSchedule[] = [MA_SCHEDULE_2023]
export const BUNDLED_FEDERAL_SCHEDULES: FederalEstateTaxSchedule[] = [FEDERAL_SCHEDULE_2025]

/** Today as `YYYY-MM-DD`, in the firm's local reckoning rather than UTC. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function covers(schedule: EstateTaxSchedule, asOf: string): boolean {
  if (asOf < schedule.effectiveFrom) return false
  return schedule.effectiveTo === null || asOf <= schedule.effectiveTo
}

/**
 * The schedule in force on a date, or an explicit miss.
 *
 * Dates are compared as ISO strings, which sorts correctly for `YYYY-MM-DD` and
 * avoids the timezone shifts that make `Date` comparisons wrong by a day at the
 * exact boundaries that matter here — the first and last day of a tax year.
 */
export function resolveScheduleAsOf<T extends EstateTaxSchedule>(
  schedules: T[],
  asOf: string,
): ScheduleLookup<T> {
  const applicable = schedules
    .filter(schedule => covers(schedule, asOf))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))

  if (applicable.length > 0) return { ok: true, schedule: applicable[0] }

  const mostRecent = [...schedules].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  )[0]
  return { ok: false, reason: 'none_on_file', asOf, mostRecent: mostRecent ?? null }
}

/** The tentative tax before the credit, from the bracket table. */
export function tentativeTax(adjusted: number, brackets: EstateTaxBracket[]): number {
  if (adjusted <= 0) return 0
  for (const bracket of brackets) {
    if (bracket.upTo === null || adjusted <= bracket.upTo) {
      return bracket.base + (adjusted - bracket.from) * bracket.rate
    }
  }
  return 0
}

export function massachusettsEstateTax(
  grossEstate: number,
  schedule: MassachusettsEstateTaxSchedule,
): number {
  const adjusted = grossEstate - schedule.adjustment
  if (adjusted <= 0) return 0
  return Math.max(0, tentativeTax(adjusted, schedule.brackets) - schedule.credit)
}

/**
 * Massachusetts tax with a credit-shelter plan in place. A two-trust plan parks
 * the first spouse's exemption in the shelter trust, so only what is left is
 * taxed at the second death.
 */
export function massachusettsEstateTaxWithCreditShelter(
  grossEstate: number,
  schedule: MassachusettsEstateTaxSchedule,
): number {
  return massachusettsEstateTax(Math.max(0, grossEstate - schedule.exemption), schedule)
}

export function federalEstateTax(
  grossEstate: number,
  schedule: FederalEstateTaxSchedule,
  options?: { married?: boolean },
): number {
  const exemption = options?.married ? schedule.exemption * 2 : schedule.exemption
  return Math.round(Math.max(0, grossEstate - exemption) * schedule.rate)
}
