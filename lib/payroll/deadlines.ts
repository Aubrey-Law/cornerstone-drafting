import { daysBetween, isoDate, nextBusinessDay } from './dates'
import type { RegisterRow } from './types'

/**
 * The workbook's Deadlines tab. Due dates fall on the statutory day and roll
 * past a weekend to Monday; federal and state holidays are not modelled, so
 * the page says to check the agency calendar.
 */

export interface PayrollDeadline {
  key: string
  title: string
  agency: string
  dueDate: string
  notes: string
  kind: 'filing' | 'deposit' | 'review'
}

const QUARTER_DUE: Record<1 | 2 | 3 | 4, (year: number) => string> = {
  1: year => isoDate(year, 4, 30),
  2: year => isoDate(year, 7, 31),
  3: year => isoDate(year, 10, 31),
  4: year => isoDate(year + 1, 1, 31),
}

export function payrollDeadlines(taxYear: number): PayrollDeadline[] {
  const list: PayrollDeadline[] = []
  for (const q of [1, 2, 3, 4] as const) {
    list.push({ key: `941-Q${q}`, title: `Form 941, Q${q}`, agency: 'IRS', dueDate: QUARTER_DUE[q](taxYear), notes: 'Wages, withholding, Social Security and Medicare.', kind: 'filing' })
  }
  for (const q of [1, 2, 3, 4] as const) {
    list.push({ key: `DUA-Q${q}`, title: `MA UI wage report + contributions, Q${q}`, agency: 'MA DUA', dueDate: QUARTER_DUE[q](taxYear), notes: 'Includes Workforce Training Fund, EMAC and assessments.', kind: 'filing' })
  }
  for (const q of [1, 2, 3, 4] as const) {
    list.push({ key: `PFML-Q${q}`, title: `MA PFML report + remittance, Q${q}`, agency: 'MA DFML', dueDate: QUARTER_DUE[q](taxYear), notes: 'Employee-paid contributions.', kind: 'filing' })
  }
  const jan31 = isoDate(taxYear + 1, 1, 31)
  list.push(
    { key: '940', title: 'Form 940 (FUTA), annual', agency: 'IRS', dueDate: jan31, notes: 'Deposit quarterly if the FUTA liability exceeds $500.', kind: 'filing' },
    { key: 'W2-W3', title: 'W-2 and W-3', agency: 'SSA Business Services Online', dueDate: jan31, notes: 'Also furnish your copy of the W-2.', kind: 'filing' },
    { key: 'MA-annual', title: 'MA annual withholding reconciliation + W-2 filing', agency: 'MA DOR, MassTaxConnect', dueDate: jan31, notes: 'Confirm the form and date for the year.', kind: 'filing' },
    { key: 'reasonable-comp', title: 'Review S corp reasonable compensation', agency: 'You + CPA', dueDate: isoDate(taxYear, 12, 1), notes: 'Do this before year-end so you can adjust December payroll.', kind: 'review' },
  )
  return list
    .map(item => ({ ...item, dueDate: nextBusinessDay(item.dueDate) }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key))
}

/** One federal deposit per pay date, on the Register's due date (rolled past weekends). */
export function depositDeadlines(register: RegisterRow[]): PayrollDeadline[] {
  return register.map(row => ({
    key: `fed-deposit:${row.id}`,
    title: `Federal tax deposit (EFTPS) for ${row.payDate} payroll`,
    agency: 'IRS EFTPS',
    dueDate: nextBusinessDay(row.paycheck.fedDepositDue),
    notes: `Federal WH plus Social Security and Medicare for period ${row.period}.`,
    kind: 'deposit' as const,
  }))
}

export function daysUntil(dueDate: string, today: string): number {
  return daysBetween(today, dueDate)
}
