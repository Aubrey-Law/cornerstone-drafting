import { applyRate } from './money'
import { sumPaychecks, type PaycheckTotals } from './calc'
import type { PayrollSettings, RegisterRow } from './types'

/** Form 941's total-tax threshold under which tax may be paid with the return. */
export const FORM_941_SMALL_LIABILITY_CENTS = 250_000
/** FUTA is deposited once the undeposited liability passes $500. */
export const FUTA_DEPOSIT_THRESHOLD_CENTS = 50_000

export interface QuarterSummary {
  quarter: 1 | 2 | 3 | 4
  runCount: number
  totals: PaycheckTotals
  /** Form 941 line 2. */
  wagesCents: number
  /** Line 3. */
  fedWhCents: number
  /** Line 5a column 1, 5c column 1, 5d column 1. */
  ssWagesCents: number
  medicareWagesCents: number
  addlMedicareWagesCents: number
  /** Line 5a/5c/5d column 2: wages × combined rate, as the return computes it. */
  line5aCents: number
  line5cCents: number
  line5dCents: number
  /** Line 7: what was actually withheld and owed per check, less the line 5 computation. */
  fractionsOfCentsCents: number
  /** SS and Medicare, employee and employer, as summed per check. */
  ficaCents: number
  /** Line 12 basis: federal WH plus FICA. */
  total941Cents: number
  depositRule: string | null
  futaCents: number
  futaCumulativeUndepositedCents: number
  futaDepositDue: boolean
  maWhCents: number
  maUiCents: number
  pfmlCents: number
}

export interface W2Summary {
  box1WagesCents: number
  box2FedWhCents: number
  box3SsWagesCents: number
  box4SsTaxCents: number
  box5MedicareWagesCents: number
  box6MedicareTaxCents: number
  box14PfmlCents: number
  box16StateWagesCents: number
  box17StateTaxCents: number
  /** Wages paid before the first run in this module, which the boxes do not include. */
  priorWagesExcludedCents: number
}

export interface PayrollSummary {
  quarters: QuarterSummary[]
  year: PaycheckTotals
  w2: W2Summary
}

function wageBases(settings: PayrollSettings, row: RegisterRow) {
  const { grossCents: gross, ytdBeforeCents: ytd } = row.paycheck
  const threshold = settings.addlMedicareThresholdCents
  return {
    ss: Math.min(gross, Math.max(0, settings.ssWageBaseCents - ytd)),
    addl: Math.max(0, ytd + gross - threshold) - Math.max(0, ytd - threshold),
  }
}

export function summarizePayroll(settings: PayrollSettings, register: RegisterRow[]): PayrollSummary {
  let futaCarry = 0
  const quarters: QuarterSummary[] = ([1, 2, 3, 4] as const).map(quarter => {
    const rows = register.filter(row => row.paycheck.quarter === quarter)
    const totals = sumPaychecks(rows.map(row => row.paycheck))
    const ssWages = rows.reduce((sum, row) => sum + wageBases(settings, row).ss, 0)
    const addlWages = rows.reduce((sum, row) => sum + wageBases(settings, row).addl, 0)
    const line5a = applyRate(ssWages, settings.ssRateMicros * 2)
    const line5c = applyRate(totals.grossCents, settings.medicareRateMicros * 2)
    const line5d = applyRate(addlWages, settings.addlMedicareRateMicros)
    const fica = totals.ssEeCents + totals.ssErCents + totals.medicareEeCents + totals.medicareErCents
    const total941 = totals.fedWhCents + fica

    futaCarry += totals.futaCents
    const futaCumulative = futaCarry
    const futaDepositDue = futaCarry > FUTA_DEPOSIT_THRESHOLD_CENTS
    if (futaDepositDue) futaCarry = 0

    return {
      quarter,
      runCount: rows.length,
      totals,
      wagesCents: totals.grossCents,
      fedWhCents: totals.fedWhCents,
      ssWagesCents: ssWages,
      medicareWagesCents: totals.grossCents,
      addlMedicareWagesCents: addlWages,
      line5aCents: line5a,
      line5cCents: line5c,
      line5dCents: line5d,
      fractionsOfCentsCents: fica - (line5a + line5c + line5d),
      ficaCents: fica,
      total941Cents: total941,
      depositRule: total941 === 0
        ? null
        : total941 < FORM_941_SMALL_LIABILITY_CENTS
          ? 'Under $2,500: may pay with Form 941'
          : 'Deposit by due dates',
      futaCents: totals.futaCents,
      futaCumulativeUndepositedCents: futaCumulative,
      futaDepositDue,
      maWhCents: totals.maWhCents,
      maUiCents: totals.maUiCents,
      pfmlCents: totals.pfmlEeCents + totals.pfmlErCents,
    }
  })

  const year = sumPaychecks(register.map(row => row.paycheck))
  const prior = settings.priorWagesCents
  return {
    quarters,
    year,
    w2: {
      box1WagesCents: year.grossCents,
      box2FedWhCents: year.fedWhCents,
      box3SsWagesCents: quarters.reduce((sum, q) => sum + q.ssWagesCents, 0),
      box4SsTaxCents: year.ssEeCents,
      box5MedicareWagesCents: year.grossCents,
      box6MedicareTaxCents: year.medicareEeCents,
      box14PfmlCents: year.pfmlEeCents,
      box16StateWagesCents: year.grossCents,
      box17StateTaxCents: year.maWhCents,
      priorWagesExcludedCents: prior,
    },
  }
}
