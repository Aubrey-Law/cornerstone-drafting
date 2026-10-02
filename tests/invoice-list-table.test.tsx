// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InvoiceListTable, type InvoiceListRowView } from '@/components/billing/InvoiceListTable'

const base: InvoiceListRowView = {
  id: 'invoice-1',
  matterId: 'matter-1',
  number: '2026-0001',
  numberYear: 2026,
  kind: 'invoice',
  status: 'issued',
  payer: 'client',
  subtotalCents: 250000,
  issueDate: '2026-09-01',
  dueDate: '2026-09-15',
  notes: null,
  terms: null,
  billToName: 'Jordan Client',
  billToEmail: 'jordan@example.com',
  paymentLink: null,
  issuedAt: '2026-09-01T12:00:00Z',
  sentAt: '2026-09-01T12:00:00Z',
  lastRemindedAt: null,
  paidAt: null,
  voidedAt: null,
  voidReason: null,
  pdfDocumentId: null,
  docxDocumentId: null,
  createdAt: '2026-08-31T12:00:00Z',
  clientName: 'Jordan Client',
  clientEmail: 'jordan@example.com',
  matterNumber: '26-001',
  collected: 0,
  balance: 250000,
  overdue: false,
  daysPastDue: 0,
}

describe('invoice collections table', () => {
  afterEach(cleanup)

  it('offers one safe next action for each invoice state', () => {
    render(<InvoiceListTable invoices={[
      { ...base, id: 'draft', number: null, status: 'draft' },
      { ...base, id: 'late', overdue: true, daysPastDue: 13 },
      { ...base, id: 'open', number: '2026-0002', dueDate: '2026-10-10' },
      { ...base, id: 'paid', number: '2026-0003', status: 'paid', balance: 0, collected: 250000, paidAt: '2026-09-12T12:00:00Z' },
    ]} />)

    expect(screen.getByRole('link', { name: 'Continue draft for Jordan Client' }).getAttribute('href')).toBe('/admin/billing/invoices/draft/edit')
    expect(screen.getByRole('link', { name: 'Review reminder for Jordan Client' }).getAttribute('href')).toBe('/admin/billing/invoices/late')
    expect(screen.getByRole('link', { name: 'Record payment for Jordan Client' }).getAttribute('href')).toBe('/admin/billing/invoices/open')
    expect(screen.getByRole('link', { name: 'View paid invoice for Jordan Client' }).getAttribute('href')).toBe('/admin/billing/invoices/paid')
  })

  it('keeps reminder review separate from sending', () => {
    render(<InvoiceListTable invoices={[{ ...base, overdue: true, daysPastDue: 13 }]} />)

    expect(screen.getByRole('link', { name: 'Review reminder for Jordan Client' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /send reminder/i })).toBeNull()
  })

  it('never treats a credit note as money to collect', () => {
    render(<InvoiceListTable invoices={[{
      ...base,
      id: 'credit',
      kind: 'credit_note',
      overdue: true,
      daysPastDue: 13,
    }]} />)

    expect(screen.getByRole('link', { name: 'View credit note for Jordan Client' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /review reminder/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /record payment/i })).toBeNull()
  })
})
