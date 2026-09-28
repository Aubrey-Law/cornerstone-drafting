// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries/invoices', () => ({
  fetchInvoicePage: vi.fn(async () => ({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
  })),
}))

import { InvoiceRegister } from '@/app/admin/billing/InvoiceRegister'

describe('invoice register shell', () => {
  afterEach(cleanup)

  it('keeps the shared Billing heading and navigation while invoices are active', async () => {
    render(await InvoiceRegister({ params: {} }))

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Billing work' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Reports' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'New invoice' })).toBeTruthy()
  })
})
