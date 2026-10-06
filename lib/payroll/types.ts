/**
 * Payroll for a single S-corp owner-employee in Massachusetts.
 *
 * Money is integer cents everywhere; rates are integer millionths ("micros"),
 * so 6.2% is 62_000 and the 0.056% Workforce Training Fund rate is 560. That
 * keeps every multiplication exact until the one rounding step each figure
 * takes, which is where the source workbook rounds too (Excel `ROUND(…, 2)`).
 */

export interface PayrollSettings {
  taxYear: number
  payPeriodsPerYear: number
  priorWagesCents: number
  fedWhPerCheckCents: number
  maExemptionCents: number
  maIncomeTaxMicros: number
  ssRateMicros: number
  ssWageBaseCents: number
  medicareRateMicros: number
  addlMedicareRateMicros: number
  addlMedicareThresholdCents: number
  futaRateMicros: number
  futaWageBaseCents: number
  maUiRateMicros: number
  maWtfRateMicros: number
  maEmacRateMicros: number
  maCovidRateMicros: number
  maUiWageBaseCents: number
  pfmlEmployeeRateMicros: number
  pfmlEmployerRateMicros: number
  /** Null means "use the Social Security wage base", as the workbook does. */
  pfmlWageCapCents: number | null
  employerName: string
  employerEin: string
  employeeName: string
  employeeAddress: string
  employeeSsnLast4: string
  ratesConfirmedAt: string | null
}

/** Every calculated figure for one pay date. */
export interface Paycheck {
  quarter: 1 | 2 | 3 | 4
  grossCents: number
  ytdBeforeCents: number
  fedWhCents: number
  ssEeCents: number
  medicareEeCents: number
  maWhCents: number
  pfmlEeCents: number
  totalWithholdingCents: number
  netCents: number
  ssErCents: number
  medicareErCents: number
  futaCents: number
  maUiCents: number
  pfmlErCents: number
  totalEmployerCents: number
  totalCostCents: number
  /** ISO date: the 15th of the month after the pay date (monthly depositor). */
  fedDepositDue: string
}

export type PayrollRunStatus = 'draft' | 'finalized'

export interface PayrollRunInput {
  id: string
  payDate: string
  grossCents: number
  fedWhOverrideCents: number | null
  status: PayrollRunStatus
  /** The stored snapshot; authoritative for a finalized run. */
  computed: Paycheck | null
}

export interface PayrollRun extends PayrollRunInput {
  taxYear: number
  netPaidOn: string | null
  fedDepositPaidOn: string | null
  eftpsConfirmation: string | null
  maDepositPaidOn: string | null
  notes: string | null
  calendarEventId: string | null
}

export interface RegisterRow {
  id: string
  period: number
  payDate: string
  status: PayrollRunStatus
  paycheck: Paycheck
  /** True when a finalized snapshot differs from what today's settings would give. */
  driftsFromSettings: boolean
}
