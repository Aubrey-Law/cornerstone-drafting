// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => ({
  result: {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    counts: { attention: 4, draft: 2, due_soon: 1, past_due: 1, paid: 7, all: 11 },
  },
}))

vi.mock('@/lib/queries/invoices', () => ({
  invoiceQueueFilters: ['attention', 'draft', 'due_soon', 'past_due', 'paid', 'all'],
  fetchInvoicePage: vi.fn(async () => query.result),
}))

import { InvoiceRegister } from '@/app/admin/billing/InvoiceRegister'

describe('invoice register shell', () => {
  afterEach(cleanup)
  beforeEach(() => {
    query.result = {
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
      counts: { attention: 4, draft: 2, due_soon: 1, past_due: 1, paid: 7, all: 11 },
    }
  })

  it('keeps the shared Billing heading and navigation while invoices are active', async () => {
    render(await InvoiceRegister({ params: {} }))

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Billing work' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Reports' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'New invoice' })).toBeTruthy()
  })

  it('presents the invoice register as searchable work queues with exact totals', async () => {
    render(await InvoiceRegister({ params: {} }))

    expect(screen.getByRole('searchbox', { name: 'Search invoices' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Needs attention 4' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Drafts 2' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Due soon 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Past due 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Paid 7' })).toBeTruthy()
    expect(screen.queryByLabelText('Issue month')).toBeNull()
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('preserves search when switching queues and identifies the filtered result set', async () => {
    render(await InvoiceRegister({ params: { search: 'Aubrey', queue: 'past_due' } }))

    expect(screen.getByRole('searchbox', { name: 'Search invoices' }).getAttribute('value')).toBe('Aubrey')
    expect(screen.getByRole('link', { name: 'Past due 1' }).getAttribute('href')).toContain('search=Aubrey')
    expect(screen.getByText(/0 past due invoices matching “Aubrey”/)).toBeTruthy()
  })
})
