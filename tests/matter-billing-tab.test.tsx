// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BillingLedgerRow } from '@/lib/billing/types'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'access-token' }))

import { Tabs } from '@/components/ui/tabs'
import { MatterBillingTab } from '@/app/admin/matters/[id]/tabs/billing'

const MATTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

function row(overrides: Partial<BillingLedgerRow> = {}): BillingLedgerRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    matterId: MATTER_ID,
    kind: 'flat_fee',
    label: 'Flat fee — Joint trust package',
    plan: null,
    amountBilled: 480_000,
    status: 'partial',
    invoicedAt: '2026-06-01T16:00:00.000Z',
    source: 'engagement',
    lastRemindedAt: null,
    createdAt: '2026-01-10T16:00:00.000Z',
    clientName: 'Chen, Marcus & Lily',
    clientEmail: 'chen@example.com',
    matterNumber: '2026-EP-Chen-014',
    practiceArea: 'EP',
    planType: 'joint_trust',
    legalPlan: null,
    payments: [],
    collected: 150_000,
    balance: 330_000,
    ageDays: 12,
    overdue: false,
    paidAt: null,
    ...overrides,
  }
}

const fetchMock = vi.fn()

function respondWith(view: {
  rows: BillingLedgerRow[]
  legalPlan?: 'metlife' | 'legalease' | null
  hasClaim?: boolean
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ item: {} }), { status: 200 }))
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          rows: view.rows,
          legalPlan: view.legalPlan ?? null,
          hasClaim: view.hasClaim ?? false,
        }),
        { status: 200 },
      ),
    )
  })
}

function renderTab(enabled = true) {
  return render(
    <Tabs value="billing">
      <MatterBillingTab matterId={MATTER_ID} enabled={enabled} />
    </Tabs>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MatterBillingTab', () => {
  it('does not fetch until the tab is opened', () => {
    respondWith({ rows: [row()] })
    renderTab(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads this matter only, scoped by id', async () => {
    respondWith({ rows: [row()] })
    renderTab()

    await screen.findByText('Flat fee — Joint trust package')
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/billing/matters/${MATTER_ID}`)
  })

  it('shows billed, collected and balance totals', async () => {
    respondWith({
      rows: [
        row(),
        row({
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'cost',
          label: 'Deed recording fee',
          amountBilled: 15_500,
          collected: 0,
          balance: 15_500,
          status: 'to_invoice',
          invoicedAt: null,
        }),
      ],
    })
    renderTab()

    await screen.findByText('Deed recording fee')
    const footer = screen.getByText('Total').closest('tr') as HTMLElement
    expect(within(footer).getByText('$4,955')).toBeTruthy()
    expect(within(footer).getByText('$1,500')).toBeTruthy()
    expect(within(footer).getByText('Balance $3,455')).toBeTruthy()
  })

  it('reads Overdue in place of the workflow status', async () => {
    respondWith({ rows: [row({ overdue: true, ageDays: 64 })] })
    renderTab()

    // Fees table plus the balance-card pill.
    expect(await screen.findAllByText('Overdue')).toHaveLength(2)
    expect(screen.queryByText('Partially paid')).toBeNull()
  })

  it('lists recorded payments newest first', async () => {
    respondWith({
      rows: [
        row({
          payments: [
            {
              id: 'p1',
              billingItemId: '11111111-1111-4111-8111-111111111111',
              amount: 50_000,
              method: 'check',
              note: 'Deposit',
              receivedAt: '2026-06-02T16:00:00.000Z',
            },
            {
              id: 'p2',
              billingItemId: '11111111-1111-4111-8111-111111111111',
              amount: 100_000,
              method: 'plan_eft',
              note: null,
              receivedAt: '2026-06-20T16:00:00.000Z',
            },
          ],
        }),
      ],
    })
    renderTab()

    const table = (await screen.findByText('Method')).closest('table') as HTMLElement
    const amounts = within(table)
      .getAllByRole('row')
      .slice(1)
      .map(tr => tr.textContent)
    expect(amounts[0]).toContain('$1,000')
    expect(amounts[0]).toContain('Plan EFT')
    expect(amounts[1]).toContain('$500')
    expect(amounts[1]).toContain('Deposit')
  })

  it('posts a payment through the audited route and reloads', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Log payment' }))
    const dialog = await screen.findByRole('dialog')
    // Prefilled with the open balance.
    expect(within(dialog).getByLabelText('Amount').getAttribute('value')).toBe('3300.00')
    await user.click(within(dialog).getByRole('button', { name: 'Save payment' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')
      expect(post?.[0]).toBe(
        '/api/admin/billing/items/11111111-1111-4111-8111-111111111111/payments',
      )
      expect(JSON.parse(post![1].body)).toEqual({
        amount: 330_000,
        method: 'check',
        note: null,
      })
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('sends an invoice for a to_invoice item', async () => {
    const user = userEvent.setup()
    respondWith({
      rows: [row({ status: 'to_invoice', invoicedAt: null, collected: 0, balance: 480_000 })],
    })
    renderTab()

    await user.click(
      await screen.findByRole('button', { name: /Send invoice for Flat fee/ }),
    )
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')
      expect(post?.[0]).toBe(
        '/api/admin/billing/items/11111111-1111-4111-8111-111111111111/invoice',
      )
    })
  })

  it('logs a reminder for an overdue item', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row({ overdue: true, ageDays: 64 })] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: /Send payment reminder/ }))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')
      expect(post?.[0]).toBe(
        '/api/admin/billing/items/11111111-1111-4111-8111-111111111111/reminder',
      )
    })
  })

  it('nudges when a covered matter has no claim', async () => {
    respondWith({ rows: [row()], legalPlan: 'metlife' })
    renderTab()

    expect(await screen.findByText('MetLife plan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a claim' })).toBeTruthy()
  })

  it('shows claim progress instead of the nudge once a claim exists', async () => {
    respondWith({
      rows: [
        row({
          kind: 'plan_claim',
          plan: 'metlife',
          label: 'MetLife claim',
          status: 'claim_submitted',
          collected: 0,
          balance: 480_000,
        }),
      ],
      legalPlan: 'metlife',
      hasClaim: true,
    })
    renderTab()

    // Appears twice: the fees-table row label and the rail card title.
    expect(await screen.findAllByText('MetLife claim')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Start a claim' })).toBeNull()
    expect(screen.getAllByText('Claim submitted').length).toBeGreaterThan(0)
  })

  it('hides the claim card when the matter has no plan', async () => {
    respondWith({ rows: [row()] })
    renderTab()

    await screen.findByText('Flat fee — Joint trust package')
    expect(screen.queryByText(/claim/i)).toBeNull()
  })

  it('surfaces a load failure with a retry', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    )
    renderTab()

    expect(await screen.findByText('Billing unavailable')).toBeTruthy()
    respondWith({ rows: [row()] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Flat fee — Joint trust package')).toBeTruthy()
  })

  it('adds a cost against this matter, without a matter picker', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    // The matter is fixed on this surface.
    expect(within(dialog).queryByLabelText('Matter')).toBeNull()

    await user.click(within(dialog).getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Cost' }))
    await user.type(within(dialog).getByLabelText('Description'), 'Deed recording fee')
    await user.type(within(dialog).getByLabelText('Amount'), '155')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        call => call[1]?.method === 'POST' && call[0] === '/api/admin/billing/items',
      )
      expect(JSON.parse(post![1].body)).toEqual({
        matterId: MATTER_ID,
        kind: 'cost',
        label: 'Deed recording fee',
        amountBilled: 15_500,
        plan: null,
      })
    })
  })

  it('will not submit a charge with no amount', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Description'), 'Deed recording fee')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(call => call[0] === '/api/admin/billing/items'),
    ).toBe(false)
  })

  it('offers Add charge from the empty state when nothing is billed', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [] })
    renderTab()

    await screen.findByText('Nothing billed yet')
    await user.click(screen.getAllByRole('button', { name: 'Add charge' })[0])
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('starts a claim from the plan nudge with the plan preselected', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()], legalPlan: 'metlife' })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Start a claim' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Legal Plan Claim' }))

    await user.type(within(dialog).getByLabelText('Description'), 'MetLife claim')
    await user.type(within(dialog).getByLabelText('Amount'), '1275')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[0] === '/api/admin/billing/items')
      expect(JSON.parse(post![1].body)).toMatchObject({
        kind: 'plan_claim',
        plan: 'metlife',
        amountBilled: 127_500,
      })
    })
  })

  it('offers all three charge types, defaulting to a legal fee', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText('Type'))

    expect(
      (await screen.findAllByRole('option')).map(option => option.textContent),
    ).toEqual(['Legal Fee', 'Legal Plan Claim', 'Cost'])
    expect(
      screen.getByRole('option', { name: 'Legal Fee' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('adds a legal fee alongside the engagement-seeded one', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Description'), 'Additional trust work')
    await user.type(within(dialog).getByLabelText('Amount'), '750')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[0] === '/api/admin/billing/items')
      expect(JSON.parse(post![1].body)).toEqual({
        matterId: MATTER_ID,
        kind: 'flat_fee',
        label: 'Additional trust work',
        amountBilled: 75_000,
        plan: null,
      })
    })
  })
})
