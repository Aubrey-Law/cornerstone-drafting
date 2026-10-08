// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TodayBilling } from '@/lib/queries/today'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}))

import { TodayBillingCard } from '@/app/admin/components/TodayBillingCard'

function billing(overrides: Partial<TodayBilling> = {}): TodayBilling {
  return {
    unbilledCount: 0,
    unbilledCents: 0,
    overdueInvoices: [],
    overdueCents: 0,
    ...overrides,
  }
}

function overdue(index: number, daysPastDue: number) {
  return {
    id: `inv-${index}`,
    number: `2026-000${index}`,
    matterId: `matter-${index}`,
    clientName: `Client ${index}`,
    balanceCents: 100_000,
    daysPastDue,
  }
}

describe('TodayBillingCard', () => {
  afterEach(cleanup)

  it('labels billing navigation honestly when data is unavailable', () => {
    render(<TodayBillingCard billing={billing({ error: 'Billing is unavailable. Please retry.' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Billing' }).getAttribute('href')).toBe('/admin/billing')
    expect(screen.queryByText('Retry billing')).toBeNull()
  })

  it('renders nothing when there is no money to chase', () => {
    // Today is a queue. A card that always shows is a card you stop reading.
    const { container } = render(<TodayBillingCard billing={billing()} />)
    expect(container.firstChild).toBeNull()
  })

  it('links unbilled work straight to the To invoice filter', () => {
    render(<TodayBillingCard billing={billing({ unbilledCount: 3, unbilledCents: 124_000 })} />)

    expect(screen.getByText('3 charges to invoice')).toBeTruthy()
    expect(screen.getByText('$1,240 not yet billed')).toBeTruthy()
    expect(screen.getByRole('link', { name: /3 charges to invoice/ }).getAttribute('href'))
      .toBe('/admin/billing?filter=to_invoice')
  })

  it('singularises a lone charge', () => {
    render(<TodayBillingCard billing={billing({ unbilledCount: 1, unbilledCents: 45_000 })} />)
    expect(screen.getByText('1 charge to invoice')).toBeTruthy()
  })

  it('lists overdue invoices and links each to itself', () => {
    render(<TodayBillingCard billing={billing({
      overdueInvoices: [overdue(1, 12)],
      overdueCents: 100_000,
    })} />)

    expect(screen.getByText('Client 1')).toBeTruthy()
    expect(screen.getByText(/Invoice 2026-0001 · \$1,000 · 12 days past due/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Client 1/ }).getAttribute('href'))
      .toBe('/admin/billing/invoices/inv-1')
  })

  it('shows three overdue invoices and offers the rest behind one link', () => {
    render(<TodayBillingCard billing={billing({
      overdueInvoices: [overdue(1, 40), overdue(2, 30), overdue(3, 20), overdue(4, 10), overdue(5, 5)],
      overdueCents: 500_000,
    })} />)

    expect(screen.getAllByRole('link', { name: /Client/ })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'View 2 more overdue invoices' }).getAttribute('href'))
      .toBe('/admin/billing?filter=overdue')
  })
})
