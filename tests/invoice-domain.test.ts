import { describe, expect, it } from 'vitest'
import {
  inferTerm,
  invoiceOverdue,
  invoiceStatusPresentation,
  invoiceTotals,
  resolveDueDate,
  type Invoice,
} from '@/lib/billing/invoices'

describe('resolveDueDate', () => {
  it.each([
    ['due_on_receipt', '2026-09-30', '2026-09-30'],
    ['net_15', '2026-09-30', '2026-10-15'],
    ['net_30', '2026-09-30', '2026-10-30'],
    ['net_60', '2026-09-30', '2026-11-29'],
    // Across a leap day, and across a year boundary.
    ['net_30', '2028-02-01', '2028-03-02'],
    ['net_60', '2026-12-15', '2027-02-13'],
  ] as const)('%s from %s is due %s', (term, issue, expected) => {
    expect(resolveDueDate(issue, term)).toBe(expected)
  })

  it('does not shift a day across a daylight-saving boundary', () => {
    // US DST ends 2026-11-01. Local-time arithmetic would land on 11-30.
    expect(resolveDueDate('2026-10-31', 'net_30')).toBe('2026-11-30')
  })
})

describe('inferTerm', () => {
  it('recovers the term a stored date pair came from', () => {
    expect(inferTerm('2026-09-30', '2026-10-30')).toBe('net_30')
    expect(inferTerm('2026-09-30', '2026-09-30')).toBe('due_on_receipt')
  })

  it('returns null for a hand-picked date that matches no term', () => {
    expect(inferTerm('2026-09-30', '2026-10-07')).toBeNull()
    expect(inferTerm(null, '2026-10-07')).toBeNull()
    expect(inferTerm('2026-09-30', null)).toBeNull()
  })
})

function invoice(overrides: Partial<Invoice> = {}): Pick<Invoice, 'status' | 'dueDate'> {
  return { status: 'issued', dueDate: '2026-09-30', ...overrides }
}

describe('invoiceOverdue', () => {
  it('is not overdue on the due date itself', () => {
    expect(invoiceOverdue(invoice(), 100_000, '2026-09-30'))
      .toEqual({ overdue: false, daysPastDue: 0 })
  })

  it('is overdue the day after, and counts calendar days', () => {
    expect(invoiceOverdue(invoice(), 100_000, '2026-10-01'))
      .toEqual({ overdue: true, daysPastDue: 1 })
    expect(invoiceOverdue(invoice(), 100_000, '2026-10-31'))
      .toEqual({ overdue: true, daysPastDue: 31 })
  })

  it('is never overdue once the balance is cleared', () => {
    expect(invoiceOverdue(invoice(), 0, '2026-12-01'))
      .toEqual({ overdue: false, daysPastDue: 0 })
  })

  it('is never overdue while a draft or once voided', () => {
    expect(invoiceOverdue(invoice({ status: 'draft' }), 100_000, '2026-12-01'))
      .toEqual({ overdue: false, daysPastDue: 0 })
    expect(invoiceOverdue(invoice({ status: 'void' }), 100_000, '2026-12-01'))
      .toEqual({ overdue: false, daysPastDue: 0 })
  })

  it('is not overdue when no due date was set', () => {
    expect(invoiceOverdue(invoice({ dueDate: null }), 100_000, '2026-12-01'))
      .toEqual({ overdue: false, daysPastDue: 0 })
  })
})

describe('invoiceTotals', () => {
  it('sums the selected charges in cents', () => {
    expect(invoiceTotals([{ amountBilled: 200_000 }, { amountBilled: 45_000 }]))
      .toEqual({ subtotalCents: 245_000, lineCount: 2 })
  })

  it('reports an empty selection rather than throwing', () => {
    expect(invoiceTotals([])).toEqual({ subtotalCents: 0, lineCount: 0 })
  })
})

describe('invoiceStatusPresentation', () => {
  it('puts overdue ahead of the stored status', () => {
    expect(invoiceStatusPresentation({ status: 'issued' }, true))
      .toEqual({ label: 'Overdue', tone: 'overdue' })
    expect(invoiceStatusPresentation({ status: 'partial' }, true))
      .toEqual({ label: 'Overdue', tone: 'overdue' })
  })

  it('keeps paid and void ahead of overdue', () => {
    expect(invoiceStatusPresentation({ status: 'paid' }, true))
      .toEqual({ label: 'Paid', tone: 'paid' })
    expect(invoiceStatusPresentation({ status: 'void' }, true))
      .toEqual({ label: 'Void', tone: 'void' })
  })

  it.each([
    ['draft', 'Draft', 'neutral'],
    ['issued', 'Sent', 'invoiced'],
    ['partial', 'Partly paid', 'partial'],
  ] as const)('renders %s as %s', (status, label, tone) => {
    expect(invoiceStatusPresentation({ status }, false)).toEqual({ label, tone })
  })
})
