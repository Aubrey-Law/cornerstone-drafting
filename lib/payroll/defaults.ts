import type { PayrollSettings } from './types'

/**
 * 2026 defaults, from the firm's payroll workbook. Federal figures are set by
 * the IRS each year; the Massachusetts UI, Workforce Training Fund, EMAC and
 * COVID rates come from the employer's own DUA rate notice, so the Setup tab
 * flags them until someone confirms them against the notice.
 */
export const RATE_DEFAULTS_2026 = {
  payPeriodsPerYear: 12,
  priorWagesCents: 0,
  fedWhPerCheckCents: 0,
  maExemptionCents: 440_000,
  maIncomeTaxMicros: 50_000,
  ssRateMicros: 62_000,
  ssWageBaseCents: 18_450_000,
  medicareRateMicros: 14_500,
  addlMedicareRateMicros: 9_000,
  addlMedicareThresholdCents: 20_000_000,
  futaRateMicros: 6_000,
  futaWageBaseCents: 700_000,
  maUiRateMicros: 24_200,
  maWtfRateMicros: 560,
  maEmacRateMicros: 0,
  maCovidRateMicros: 0,
  maUiWageBaseCents: 1_500_000,
  pfmlEmployeeRateMicros: 4_600,
  pfmlEmployerRateMicros: 0,
  pfmlWageCapCents: null,
} satisfies Partial<PayrollSettings>

export function defaultSettings(taxYear: number): PayrollSettings {
  return {
    taxYear,
    ...RATE_DEFAULTS_2026,
    employerName: '',
    employerEin: '',
    employeeName: '',
    employeeAddress: '',
    employeeSsnLast4: '',
    ratesConfirmedAt: null,
  }
}

export type SettingKey = keyof typeof RATE_DEFAULTS_2026 | 'fedWhPerCheckCents'

export interface SettingField {
  key: SettingKey
  label: string
  kind: 'cents' | 'rate' | 'count' | 'centsOrNull'
  note: string
  /** The workbook's yellow cells: confirm against your own notices. */
  confirm?: boolean
}

/** The Setup tab, row for row. */
export const SETTING_FIELDS: SettingField[] = [
  { key: 'payPeriodsPerYear', label: 'Pay periods per year', kind: 'count', note: '12 = monthly, 24 = semi-monthly, 26 = biweekly.' },
  { key: 'priorWagesCents', label: 'Wages already paid this year before the first run', kind: 'cents', note: 'Use if you paid yourself earlier in the year outside this module.' },
  { key: 'fedWhPerCheckCents', label: 'Federal income tax withheld per paycheck', kind: 'cents', note: 'From the IRS Tax Withholding Estimator / Pub 15-T using your W-4. Can be overridden on any run.', confirm: true },
  { key: 'maExemptionCents', label: 'MA annual exemption amount (Form M-4)', kind: 'cents', note: 'Update to your M-4 total; verify against Circular M.', confirm: true },
  { key: 'maIncomeTaxMicros', label: 'MA income tax withholding rate', kind: 'rate', note: 'Flat 5% (the 4% surtax applies only above the annual threshold).' },
  { key: 'ssRateMicros', label: 'Social Security rate (each side)', kind: 'rate', note: 'IRS.' },
  { key: 'ssWageBaseCents', label: 'Social Security wage base', kind: 'cents', note: '2026 base; also caps PFML wages.' },
  { key: 'medicareRateMicros', label: 'Medicare rate (each side)', kind: 'rate', note: 'IRS.' },
  { key: 'addlMedicareRateMicros', label: 'Additional Medicare rate (employee only)', kind: 'rate', note: 'Applies to wages over the threshold below.' },
  { key: 'addlMedicareThresholdCents', label: 'Additional Medicare threshold', kind: 'cents', note: 'Employer withholding threshold.' },
  { key: 'futaRateMicros', label: 'FUTA net rate', kind: 'rate', note: '6.0% less the 5.4% credit when state UI is paid on time. Confirm MA is not a credit-reduction state.', confirm: true },
  { key: 'futaWageBaseCents', label: 'FUTA wage base', kind: 'cents', note: 'IRS.' },
  { key: 'maUiRateMicros', label: 'MA UI rate', kind: 'rate', note: '2.42% is the 2026 new-employer rate. Use the rate on your DUA notice.', confirm: true },
  { key: 'maWtfRateMicros', label: 'MA Workforce Training Fund rate', kind: 'rate', note: 'Check your DUA notice; new employers may be exempt.', confirm: true },
  { key: 'maEmacRateMicros', label: 'MA EMAC rate', kind: 'rate', note: 'Phases in with employer tenure. Check your DUA notice.', confirm: true },
  { key: 'maCovidRateMicros', label: 'MA COVID recovery assessment rate', kind: 'rate', note: 'Check your DUA notice.', confirm: true },
  { key: 'maUiWageBaseCents', label: 'MA UI wage base', kind: 'cents', note: 'Per employee per year; the same base is used for assessments.' },
  { key: 'pfmlEmployeeRateMicros', label: 'MA PFML employee rate', kind: 'rate', note: 'Employers under 25: 0.46% total, charged to the employee.', confirm: true },
  { key: 'pfmlEmployerRateMicros', label: 'MA PFML employer share rate', kind: 'rate', note: '0% for employers under 25 covered individuals unless you choose to pay more.' },
  { key: 'pfmlWageCapCents', label: 'MA PFML wage cap', kind: 'centsOrNull', note: 'Blank = the Social Security wage base.' },
]
