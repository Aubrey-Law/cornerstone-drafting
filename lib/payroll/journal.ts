import { centsToDecimal } from './money'
import type { RegisterRow } from './types'

/**
 * Journal entries for the books (Mercury Accounting). Account names follow the
 * workbook's Journal tab; they are suggestions to be matched to the chart of
 * accounts, and the CSV carries them as text.
 */

export const PAYROLL_ACCOUNTS = {
  wagesExpense: 'Officer / owner wages expense',
  employerTaxExpense: 'Payroll tax expense (employer share)',
  fedWhPayable: 'Federal income tax withheld payable',
  ficaPayable: 'Social Security + Medicare payable (employee and employer)',
  maWhPayable: 'MA income tax withheld payable',
  pfmlPayable: 'MA PFML payable',
  futaPayable: 'FUTA payable',
  maUiPayable: 'MA UI and assessments payable',
  cash: 'Cash / bank',
} as const

export interface JournalLine {
  account: string
  debitCents: number
  creditCents: number
}

export interface JournalEntry {
  id: string
  date: string
  memo: string
  lines: JournalLine[]
}

const debit = (account: string, cents: number): JournalLine => ({ account, debitCents: cents, creditCents: 0 })
const credit = (account: string, cents: number): JournalLine => ({ account, debitCents: 0, creditCents: cents })
const nonZero = (lines: JournalLine[]) => lines.filter(line => line.debitCents !== 0 || line.creditCents !== 0)

/** The entry for a pay date: wages and employer taxes against the payables and the net check. */
export function payrollEntry(row: RegisterRow): JournalEntry {
  const p = row.paycheck
  return {
    id: `PR-${row.payDate}`,
    date: row.payDate,
    memo: `Payroll period ${row.period} (${row.payDate})`,
    lines: nonZero([
      debit(PAYROLL_ACCOUNTS.wagesExpense, p.grossCents),
      debit(PAYROLL_ACCOUNTS.employerTaxExpense, p.totalEmployerCents),
      credit(PAYROLL_ACCOUNTS.fedWhPayable, p.fedWhCents),
      credit(PAYROLL_ACCOUNTS.ficaPayable, p.ssEeCents + p.medicareEeCents + p.ssErCents + p.medicareErCents),
      credit(PAYROLL_ACCOUNTS.maWhPayable, p.maWhCents),
      credit(PAYROLL_ACCOUNTS.pfmlPayable, p.pfmlEeCents + p.pfmlErCents),
      credit(PAYROLL_ACCOUNTS.futaPayable, p.futaCents),
      credit(PAYROLL_ACCOUNTS.maUiPayable, p.maUiCents),
      credit(`${PAYROLL_ACCOUNTS.cash} (net pay)`, p.netCents),
    ]),
  }
}

/** The EFTPS deposit for a pay date: clears federal WH and FICA. */
export function federalDepositEntry(row: RegisterRow, paidOn: string, confirmation?: string | null): JournalEntry {
  const p = row.paycheck
  const fica = p.ssEeCents + p.medicareEeCents + p.ssErCents + p.medicareErCents
  return {
    id: `FED-${row.payDate}`,
    date: paidOn,
    memo: `EFTPS deposit for ${row.payDate} payroll${confirmation ? ` (conf. ${confirmation})` : ''}`,
    lines: nonZero([
      debit(PAYROLL_ACCOUNTS.fedWhPayable, p.fedWhCents),
      debit(PAYROLL_ACCOUNTS.ficaPayable, fica),
      credit(PAYROLL_ACCOUNTS.cash, p.fedWhCents + fica),
    ]),
  }
}

export function maWithholdingDepositEntry(row: RegisterRow, paidOn: string): JournalEntry {
  return {
    id: `MAWH-${row.payDate}`,
    date: paidOn,
    memo: `MA withholding deposit for ${row.payDate} payroll`,
    lines: nonZero([
      debit(PAYROLL_ACCOUNTS.maWhPayable, row.paycheck.maWhCents),
      credit(PAYROLL_ACCOUNTS.cash, row.paycheck.maWhCents),
    ]),
  }
}

/** A quarterly or annual remittance that clears one payable (DUA, PFML, FUTA). */
export function remittanceEntry(input: { id: string; date: string; memo: string; account: string; cents: number }): JournalEntry {
  return {
    id: input.id,
    date: input.date,
    memo: input.memo,
    lines: nonZero([debit(input.account, input.cents), credit(PAYROLL_ACCOUNTS.cash, input.cents)]),
  }
}

export function entryTotals(entry: JournalEntry): { debitCents: number; creditCents: number; balanced: boolean } {
  const debitCents = entry.lines.reduce((sum, line) => sum + line.debitCents, 0)
  const creditCents = entry.lines.reduce((sum, line) => sum + line.creditCents, 0)
  return { debitCents, creditCents, balanced: debitCents === creditCents }
}

/**
 * Quoting only; amounts stay plain numbers so bookkeeping software reads them
 * (same choice as the billing accounting export). Text cells that could be
 * read as a formula get a leading apostrophe.
 */
function cell(value: string | number): string {
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toJournalCsv(entries: JournalEntry[]): string {
  const rows: (string | number)[][] = [['Date', 'Journal entry', 'Account', 'Debit', 'Credit', 'Memo']]
  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        entry.date,
        entry.id,
        line.account,
        line.debitCents ? centsToDecimal(line.debitCents) : '',
        line.creditCents ? centsToDecimal(line.creditCents) : '',
        entry.memo,
      ])
    }
  }
  return `${rows.map(row => row.map(cell).join(',')).join('\n')}\n`
}
