import { applyRate, mulDivRound, MICROS } from './money'
import { isoDate, parts, quarterOf } from './dates'
import type { Paycheck, PayrollRunInput, PayrollSettings, RegisterRow } from './types'

/**
 * The paycheck math from the workbook's Register tab, one formula per column.
 * Each figure rounds once, to the cent, exactly where the workbook's ROUND does.
 */

const clampWages = (gross: number, base: number, ytdBefore: number) =>
  Math.min(gross, Math.max(0, base - ytdBefore))

export function pfmlCapCents(settings: PayrollSettings): number {
  return settings.pfmlWageCapCents ?? settings.ssWageBaseCents
}

/** The federal deposit for a monthly depositor: the 15th of the following month. */
export function federalDepositDue(payDate: string): string {
  const { year, month } = parts(payDate)
  return isoDate(year, month + 1, 15)
}

export function computePaycheck(
  settings: PayrollSettings,
  ytdBeforeCents: number,
  input: { payDate: string; grossCents: number; fedWhOverrideCents?: number | null },
): Paycheck {
  const gross = input.grossCents
  const ytd = ytdBeforeCents
  const fedWh = input.fedWhOverrideCents ?? settings.fedWhPerCheckCents

  const ssWages = clampWages(gross, settings.ssWageBaseCents, ytd)
  const ssEe = applyRate(ssWages, settings.ssRateMicros)

  // Additional Medicare is charged only on the slice of this check above the threshold.
  const threshold = settings.addlMedicareThresholdCents
  const addlSlice = Math.max(0, ytd + gross - threshold) - Math.max(0, ytd - threshold)
  const medicareEe = mulDivRound(
    gross * settings.medicareRateMicros + addlSlice * settings.addlMedicareRateMicros,
    1,
    MICROS,
  )

  // MA: (gross − annual exemption ÷ periods) × rate, exact before the one rounding.
  const periods = Math.max(1, settings.payPeriodsPerYear)
  const maTaxableScaled = Math.max(0, gross * periods - settings.maExemptionCents)
  const maWh = mulDivRound(maTaxableScaled, settings.maIncomeTaxMicros, periods * MICROS)

  const pfmlWages = clampWages(gross, pfmlCapCents(settings), ytd)
  const pfmlEe = applyRate(pfmlWages, settings.pfmlEmployeeRateMicros)

  const totalWithholding = fedWh + ssEe + medicareEe + maWh + pfmlEe

  const ssEr = ssEe
  const medicareEr = applyRate(gross, settings.medicareRateMicros)
  const futa = applyRate(clampWages(gross, settings.futaWageBaseCents, ytd), settings.futaRateMicros)
  const maUiRate = settings.maUiRateMicros + settings.maWtfRateMicros + settings.maEmacRateMicros + settings.maCovidRateMicros
  const maUi = applyRate(clampWages(gross, settings.maUiWageBaseCents, ytd), maUiRate)
  const pfmlEr = applyRate(pfmlWages, settings.pfmlEmployerRateMicros)
  const totalEmployer = ssEr + medicareEr + futa + maUi + pfmlEr

  return {
    quarter: quarterOf(input.payDate),
    grossCents: gross,
    ytdBeforeCents: ytd,
    fedWhCents: fedWh,
    ssEeCents: ssEe,
    medicareEeCents: medicareEe,
    maWhCents: maWh,
    pfmlEeCents: pfmlEe,
    totalWithholdingCents: totalWithholding,
    netCents: gross - totalWithholding,
    ssErCents: ssEr,
    medicareErCents: medicareEr,
    futaCents: futa,
    maUiCents: maUi,
    pfmlErCents: pfmlEr,
    totalEmployerCents: totalEmployer,
    totalCostCents: gross + totalEmployer,
    fedDepositDue: federalDepositDue(input.payDate),
  }
}

const SNAPSHOT_KEYS: (keyof Paycheck)[] = [
  'grossCents', 'ytdBeforeCents', 'fedWhCents', 'ssEeCents', 'medicareEeCents', 'maWhCents',
  'pfmlEeCents', 'netCents', 'ssErCents', 'medicareErCents', 'futaCents', 'maUiCents', 'pfmlErCents',
]

export function sameFigures(a: Paycheck, b: Paycheck): boolean {
  return SNAPSHOT_KEYS.every(key => a[key] === b[key])
}

/**
 * The register for a tax year. Runs are walked in pay-date order; YTD comes
 * from gross wages, which never change after a run is finalized. A finalized
 * run keeps its stored snapshot so a later rate change cannot rewrite a check
 * that was already paid; a draft is always recomputed from current settings.
 */
export function computeRegister(settings: PayrollSettings, runs: PayrollRunInput[]): RegisterRow[] {
  const ordered = [...runs].sort((a, b) => a.payDate.localeCompare(b.payDate) || a.id.localeCompare(b.id))
  let ytd = settings.priorWagesCents
  return ordered.map((run, index) => {
    const fresh = computePaycheck(settings, ytd, run)
    const keep = run.status === 'finalized' && run.computed != null
    const paycheck = keep ? { ...run.computed!, fedDepositDue: run.computed!.fedDepositDue ?? fresh.fedDepositDue } : fresh
    ytd += run.grossCents
    return {
      id: run.id,
      period: index + 1,
      payDate: run.payDate,
      status: run.status,
      paycheck,
      driftsFromSettings: keep && !sameFigures(paycheck, fresh),
    }
  })
}

export type PaycheckTotals = Omit<Paycheck, 'quarter' | 'fedDepositDue' | 'ytdBeforeCents'>

export function sumPaychecks(paychecks: Paycheck[]): PaycheckTotals {
  const zero: PaycheckTotals = {
    grossCents: 0, fedWhCents: 0, ssEeCents: 0, medicareEeCents: 0, maWhCents: 0, pfmlEeCents: 0,
    totalWithholdingCents: 0, netCents: 0, ssErCents: 0, medicareErCents: 0, futaCents: 0,
    maUiCents: 0, pfmlErCents: 0, totalEmployerCents: 0, totalCostCents: 0,
  }
  return paychecks.reduce<PaycheckTotals>((sum, check) => {
    const next = { ...sum }
    for (const key of Object.keys(zero) as (keyof PaycheckTotals)[]) next[key] += check[key]
    return next
  }, zero)
}
