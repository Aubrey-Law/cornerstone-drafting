import { describe, expect, it } from 'vitest'
import { computeRegister } from '@/lib/payroll/calc'
import { payrollDeadlines, depositDeadlines } from '@/lib/payroll/deadlines'
import { defaultSettings } from '@/lib/payroll/defaults'
import { nextBusinessDay } from '@/lib/payroll/dates'
import {
  entryTotals,
  federalDepositEntry,
  maWithholdingDepositEntry,
  PAYROLL_ACCOUNTS,
  payrollEntry,
  remittanceEntry,
  toJournalCsv,
} from '@/lib/payroll/journal'
import { summarizePayroll } from '@/lib/payroll/quarterly'
import type { PayrollRunInput, PayrollSettings } from '@/lib/payroll/types'

const settings: PayrollSettings = { ...defaultSettings(2026), fedWhPerCheckCents: 70_000 }
const run = (id: string, payDate: string, grossCents: number): PayrollRunInput =>
  ({ id, payDate, grossCents, fedWhOverrideCents: null, status: 'draft', computed: null })

describe('quarterly summary', () => {
  const register = computeRegister(settings, [
    run('jan', '2026-01-30', 500_000),
    run('feb', '2026-02-27', 500_000),
    run('oct', '2026-10-30', 25_000_000),
  ])
  const summary = summarizePayroll(settings, register)

  it('groups runs by quarter and totals the 941 figures', () => {
    const q1 = summary.quarters[0]
    expect(q1.runCount).toBe(2)
    expect(q1.wagesCents).toBe(1_000_000)
    expect(q1.fedWhCents).toBe(140_000)
    expect(q1.ficaCents).toBe(4 * 31_000 + 4 * 7_250)
    expect(q1.total941Cents).toBe(140_000 + 153_000)
    expect(q1.depositRule).toBe('Deposit by due dates')
    expect(summary.quarters[1].depositRule).toBeNull()
    const small = summarizePayroll(settings, computeRegister(settings, [run('a', '2026-04-30', 500_000)]))
    expect(small.quarters[1].total941Cents).toBe(146_500)
    expect(small.quarters[1].depositRule).toBe('Under $2,500: may pay with Form 941')
    expect(summary.quarters[3].depositRule).toBe('Deposit by due dates')
  })

  it('computes 941 line 5 from wages and reports the rounding difference on line 7', () => {
    const q1 = summary.quarters[0]
    expect(q1.line5aCents).toBe(124_000) // 10,000 × 12.4%
    expect(q1.line5cCents).toBe(29_000) // 10,000 × 2.9%
    expect(q1.fractionsOfCentsCents).toBe(0)
    const q4 = summary.quarters[3]
    // $10,000 already paid; the base leaves $174,500 subject to SS, and $60,000 is over $200,000.
    expect(q4.ssWagesCents).toBe(17_450_000)
    expect(q4.addlMedicareWagesCents).toBe(6_000_000)
    expect(q4.line5dCents).toBe(54_000)
  })

  it('flags FUTA once the undeposited liability passes $500', () => {
    // $7,000 × 0.6% = $42, all in Q1; never above $500.
    expect(summary.quarters.map(q => q.futaDepositDue)).toEqual([false, false, false, false])
    const high = { ...settings, futaRateMicros: 60_000, futaWageBaseCents: 1_000_000 }
    const quarters = summarizePayroll(high, computeRegister(high, [run('a', '2026-01-30', 1_000_000)])).quarters
    expect(quarters[0].futaCumulativeUndepositedCents).toBe(60_000)
    expect(quarters[0].futaDepositDue).toBe(true)
  })

  it('ties out the W-2 boxes, capping box 3 at the wage base', () => {
    expect(summary.w2.box1WagesCents).toBe(26_000_000)
    expect(summary.w2.box3SsWagesCents).toBe(18_450_000)
    expect(summary.w2.box4SsTaxCents).toBe(1_143_900)
    expect(summary.w2.box5MedicareWagesCents).toBe(26_000_000)
    expect(summary.w2.box6MedicareTaxCents).toBe(summary.year.medicareEeCents)
    expect(summary.w2.box17StateTaxCents).toBe(summary.year.maWhCents)
  })
})

describe('deadlines', () => {
  it('lists the workbook obligations with weekend due dates rolled to Monday', () => {
    const list = payrollDeadlines(2026)
    const due = Object.fromEntries(list.map(d => [d.key, d.dueDate]))
    expect(due['941-Q1']).toBe('2026-04-30')
    expect(due['941-Q2']).toBe('2026-07-31')
    expect(due['941-Q3']).toBe('2026-11-02') // Oct 31 2026 is a Saturday
    expect(due['941-Q4']).toBe('2027-02-01') // Jan 31 2027 is a Sunday
    expect(due['940']).toBe('2027-02-01')
    expect(due['reasonable-comp']).toBe('2026-12-01')
    expect(list).toHaveLength(16)
    expect(new Set(list.map(d => d.key)).size).toBe(16)
  })

  it('adds one federal deposit per pay date', () => {
    const register = computeRegister(settings, [run('a', '2026-07-31', 500_000)])
    expect(depositDeadlines(register)).toEqual([expect.objectContaining({ key: 'fed-deposit:a', dueDate: '2026-08-17' })])
    expect(nextBusinessDay('2026-08-15')).toBe('2026-08-17')
  })
})

describe('journal', () => {
  const [row] = computeRegister(settings, [run('a', '2026-10-30', 500_000)])

  it('balances the payroll entry and matches the workbook Journal tab', () => {
    const entry = payrollEntry(row)
    expect(entryTotals(entry)).toEqual({ debitCents: 553_630, creditCents: 553_630, balanced: true })
    const byAccount = Object.fromEntries(entry.lines.map(l => [l.account, l]))
    expect(byAccount[PAYROLL_ACCOUNTS.wagesExpense].debitCents).toBe(500_000)
    expect(byAccount[PAYROLL_ACCOUNTS.employerTaxExpense].debitCents).toBe(53_630)
    expect(byAccount[PAYROLL_ACCOUNTS.ficaPayable].creditCents).toBe(76_500)
    expect(byAccount[`${PAYROLL_ACCOUNTS.cash} (net pay)`].creditCents).toBe(366_283)
    // The employer PFML share is zero, so its line is omitted rather than shown as 0.00.
    expect(entry.lines.every(l => l.debitCents || l.creditCents)).toBe(true)
  })

  it('clears the payables when deposits and remittances are recorded', () => {
    for (const entry of [
      federalDepositEntry(row, '2026-11-16', 'EFT123'),
      maWithholdingDepositEntry(row, '2026-11-16'),
      remittanceEntry({ id: 'DUA-Q4', date: '2027-01-29', memo: 'DUA', account: PAYROLL_ACCOUNTS.maUiPayable, cents: 12_380 }),
    ]) expect(entryTotals(entry).balanced).toBe(true)
    expect(federalDepositEntry(row, '2026-11-16').lines.at(-1)).toEqual({ account: PAYROLL_ACCOUNTS.cash, debitCents: 0, creditCents: 146_500 })
  })

  it('writes a CSV with plain-number amounts and quoted text', () => {
    const csv = toJournalCsv([payrollEntry(row)])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Date,Journal entry,Account,Debit,Credit,Memo')
    expect(lines[1]).toBe('2026-10-30,PR-2026-10-30,Officer / owner wages expense,5000.00,,Payroll period 1 (2026-10-30)')
    expect(lines).toContain('2026-10-30,PR-2026-10-30,Cash / bank (net pay),,3662.83,Payroll period 1 (2026-10-30)')
    expect(toJournalCsv([{ id: 'x', date: '2026-01-01', memo: '=HYPERLINK("x")', lines: [] }])).not.toContain('=HYPERLINK')
  })
})
