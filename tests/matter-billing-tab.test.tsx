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

function renderTab(enabled = true, overrides: Partial<React.ComponentProps<typeof MatterBillingTab>> = {}) {
  return render(
    <Tabs value="billing">
      <MatterBillingTab
        matterId={MATTER_ID}
        enabled={enabled}
        details={{ billing_type: 'flat_fee', flat_fee_amount: 4800 }}
        onSaveField={vi.fn().mockResolvedValue(undefined)}
        onCloseMatter={vi.fn().mockResolvedValue(undefined)}
        {...overrides}
      />
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

    expect(await screen.findAllByText('Overdue')).toHaveLength(1)
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

  it('nudges when a plan matter has no claim in the ledger', async () => {
    respondWith({ rows: [row()] })
    renderTab(true, { details: { billing_type: 'metlife' } })

    expect(await screen.findByText('Legal plan, claim & work dates')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a claim' })).toBeTruthy()
  })

  it('drops the nudge once a claim exists', async () => {
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
      hasClaim: true,
    })
    renderTab(true, { details: { billing_type: 'metlife' } })

    await screen.findByText('MetLife claim')
    expect(screen.queryByRole('button', { name: 'Start a claim' })).toBeNull()
    expect(screen.getAllByText('Claim submitted').length).toBeGreaterThan(0)
  })

  it('takes the claim amount from the ledger, not a hand-typed figure', async () => {
    respondWith({
      rows: [
        row({
          kind: 'plan_claim',
          plan: 'metlife',
          label: 'MetLife claim',
          amountBilled: 140_000,
          status: 'to_invoice',
          collected: 0,
          balance: 140_000,
        }),
      ],
      hasClaim: true,
    })
    // A stale figure left on the matter must not outrank the ledger.
    renderTab(true, { details: { billing_type: 'metlife', claim_amount: 999_999 } })

    await screen.findByText('MetLife claim')
    expect(screen.queryByLabelText('Claim amount')).toBeNull()
    const moneyIn = screen.getByText('Money in').closest('div[data-slot="card"]') as HTMLElement
    expect(within(moneyIn).getAllByText('$1,400').length).toBeGreaterThan(0)
    expect(within(moneyIn).queryByText(/9,999/)).toBeNull()
  })

  it('renders no claim block at all for a flat-fee matter', async () => {
    respondWith({ rows: [row()] })
    renderTab()

    await screen.findByText('Flat fee — Joint trust package')
    expect(screen.getByText('Work dates')).toBeTruthy()
    expect(screen.queryByLabelText('Claim amount')).toBeNull()
    expect(screen.queryByLabelText('Member ID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start a claim' })).toBeNull()
  })

  it('gates Close matter on all four close-out conditions', async () => {
    respondWith({ rows: [row()] })
    const { rerender } = renderTab()

    const closeButton = await screen.findByRole('button', { name: 'Close matter' })
    expect(closeButton.hasAttribute('disabled')).toBe(true)

    // Flat fee, so the two claim gates are satisfied by definition; recording
    // the work-finished and closing-package dates is all that remains.
    rerender(
      <Tabs value="billing">
        <MatterBillingTab
          matterId={MATTER_ID}
          enabled
          details={{
            billing_type: 'flat_fee',
            work_finished_date: '2026-08-01',
            closing_package_sent_date: '2026-08-03',
          }}
          onSaveField={vi.fn().mockResolvedValue(undefined)}
          onCloseMatter={vi.fn().mockResolvedValue(undefined)}
        />
      </Tabs>,
    )
    expect(screen.getByRole('button', { name: 'Close matter' }).hasAttribute('disabled')).toBe(false)
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
    renderTab(true, { details: { billing_type: 'metlife' } })

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

  it('warns before adding a second legal fee, without blocking it', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] }) // the seeded flat fee
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('status').textContent).toContain(
      'already has a legal fee',
    )

    // Advisory only — the charge still saves.
    await user.type(within(dialog).getByLabelText('Description'), 'Additional trust work')
    await user.type(within(dialog).getByLabelText('Amount'), '750')
    await user.click(within(dialog).getByRole('button', { name: 'Add charge' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[0] === '/api/admin/billing/items')
      expect(JSON.parse(post![1].body)).toMatchObject({ kind: 'flat_fee' })
    })
  })

  it('does not warn when the matter has no legal fee, or for other kinds', async () => {
    const user = userEvent.setup()
    respondWith({
      rows: [row({ kind: 'cost', label: 'Deed recording fee', amountBilled: 15_500 })],
    })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it('drops the warning when the type changes away from a legal fee', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('status')).toBeTruthy()

    await user.click(within(dialog).getByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Cost' }))
    expect(within(dialog).queryByRole('status')).toBeNull()
  })
  const SECOND_ID = '22222222-2222-4222-8222-222222222222'

  it('deletes one charge through the REST delete, after confirming', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Delete Flat fee — Joint trust package' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 1 charge' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        call => call[1]?.method === 'DELETE'
          && call[0] === `/api/admin/billing/items/${row().id}`,
      )).toBe(true)
    })
    expect(toast.success).toHaveBeenCalledWith('Charge deleted')
  })

  it('leaves the charge alone when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Delete Flat fee — Joint trust package' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  })

  it('deletes a whole selection in one bulk call', async () => {
    const user = userEvent.setup()
    respondWith({
      rows: [row(), row({ id: SECOND_ID, label: 'Deed recording fee', kind: 'cost' })],
    })
    renderTab()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all charges' }))
    await user.click(screen.getByRole('button', { name: 'Delete selected' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 charges?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 charges' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        call => call[0] === '/api/admin/billing/items/bulk-delete',
      )
      expect(JSON.parse(post![1].body)).toEqual({ ids: [row().id, SECOND_ID] })
    })
    expect(toast.success).toHaveBeenCalledWith('2 charges deleted')
  })

  it('says what a deletion costs in collected payments before it happens', async () => {
    const user = userEvent.setup()
    respondWith({
      rows: [row({
        payments: [{
          id: '55555555-5555-4555-8555-555555555555',
          billingItemId: row().id,
          amount: 150_000,
          method: 'check',
          note: null,
          receivedAt: '2026-07-18T16:00:00.000Z',
        }],
      })],
    })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Delete Flat fee — Joint trust package' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 charge?' })
    expect(within(dialog).getByRole('status').textContent).toContain('$1,500 already collected')
  })
  it('edits a charge in place, seeded from the row and sent as a PATCH', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row({ kind: 'cost', label: 'Deed recording fee', amountBilled: 15_500 })] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Edit Deed recording fee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit charge' })
    // Seeded from the row, in dollars, and the matter is not up for grabs.
    expect((within(dialog).getByLabelText('Description') as HTMLInputElement).value)
      .toBe('Deed recording fee')
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('155.00')
    expect(within(dialog).queryByLabelText('Matter')).toBeNull()

    const amount = within(dialog).getByLabelText('Amount')
    await user.clear(amount)
    await user.type(amount, '175.25')
    await user.click(within(dialog).getByRole('button', { name: 'Save charge' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH')
      expect(patch![0]).toBe(`/api/admin/billing/items/${row().id}`)
      expect(JSON.parse(patch![1].body)).toEqual({
        kind: 'cost',
        label: 'Deed recording fee',
        amountBilled: 17_525,
        plan: null,
      })
    })
    expect(toast.success).toHaveBeenCalledWith('Deed recording fee updated')
  })

  it('does not warn about a duplicate legal fee when editing the fee itself', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Edit Flat fee — Joint trust package' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit charge' })
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it('surfaces a rejected edit and keeps the dialog open', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'Amount is below the 1500.00 already collected' }),
          { status: 409 },
        ))
      }
      return Promise.resolve(new Response(
        JSON.stringify({ rows: [row()], legalPlan: null, hasClaim: false }),
        { status: 200 },
      ))
    })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Edit Flat fee — Joint trust package' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit charge' })
    await user.click(within(dialog).getByRole('button', { name: 'Save charge' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Amount is below the 1500.00 already collected')
    })
    expect(screen.getByRole('dialog', { name: 'Edit charge' })).toBeTruthy()
  })

  it('returns to adding a charge after an edit is cancelled', async () => {
    const user = userEvent.setup()
    respondWith({ rows: [row()] })
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'Edit Flat fee — Joint trust package' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Edit charge' }))
      .getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Add charge' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add charge' })
    expect((within(dialog).getByLabelText('Description') as HTMLInputElement).value).toBe('')
  })
})
