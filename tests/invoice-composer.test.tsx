// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InvoiceableCharge } from '@/lib/billing/invoices'

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'access-token' }))
vi.mock('sonner', () => ({ toast }))

import InvoiceComposer from '@/app/admin/billing/invoices/new/InvoiceComposer'

const MATTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FEE_ID = '11111111-1111-4111-8111-111111111111'
const COST_ID = '22222222-2222-4222-8222-222222222222'

const matters = [{ id: MATTER_ID, label: 'Chen, Marcus & Lily · 2026-EP-Chen-014' }]

const charges: InvoiceableCharge[] = [
  {
    id: FEE_ID,
    kind: 'flat_fee',
    label: 'Flat fee — Joint trust package',
    amountBilled: 200_000,
    createdAt: '2026-06-01T16:00:00.000Z',
  },
  {
    id: COST_ID,
    kind: 'cost',
    label: 'Deed recording fee',
    amountBilled: 45_000,
    createdAt: '2026-06-15T16:00:00.000Z',
  },
]

function renderComposer(overrides: Partial<Parameters<typeof InvoiceComposer>[0]> = {}) {
  return render(
    <InvoiceComposer
      matters={matters}
      initialMatterId={MATTER_ID}
      initialCharges={charges}
      preselectedChargeIds={[]}
      today="2026-09-30"
      firm={{ name: 'Aubrey Law', remitTo: 'Aubrey Law · Needham, MA' }}
      {...overrides}
    />,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

describe('InvoiceComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('bills every open charge by default and totals them in the preview', () => {
    renderComposer()

    const preview = screen.getByRole('article', { name: 'Invoice preview' })
    expect(within(preview).getByText('Flat fee — Joint trust package')).toBeTruthy()
    expect(within(preview).getByText('Deed recording fee')).toBeTruthy()
    // 200,000 + 45,000 cents, shown as the balance due.
    expect(within(preview).getAllByText('$2,450.00').length).toBeGreaterThan(0)
  })

  it('updates the preview as charges are unticked', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByLabelText('Deed recording fee'))

    const preview = screen.getByRole('article', { name: 'Invoice preview' })
    expect(within(preview).queryByText('Deed recording fee')).toBeNull()
    expect(within(preview).getAllByText('$2,000.00').length).toBeGreaterThan(0)
  })

  it('derives the due date from the selected terms', async () => {
    renderComposer()

    // Net 30 from 2026-09-30.
    expect(screen.getByText('Due 2026-10-30')).toBeTruthy()
  })

  it('refuses to issue with nothing selected', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByLabelText('Flat fee — Joint trust package'))
    await user.click(screen.getByLabelText('Deed recording fee'))

    const issue = screen.getByRole('button', { name: /Issue & send/ })
    expect(issue.hasAttribute('disabled')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the draft, then issues it, and lands on the invoice', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ invoice: { id: 'invoice-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sent: true }),
      })
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & send/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toBe('/api/admin/billing/invoices')
    expect(JSON.parse(createInit.body)).toMatchObject({
      matterId: MATTER_ID,
      itemIds: [FEE_ID, COST_ID],
      issueDate: '2026-09-30',
      dueDate: '2026-10-30',
    })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/billing/invoices/invoice-1/issue')
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-1')
    expect(toast.success).toHaveBeenCalledWith('Invoice issued and emailed')
  })

  it('saves a draft without issuing it', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ invoice: { id: 'invoice-2' } }),
    })
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Save draft/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Draft invoice saved')
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-2')
  })

  it('surfaces a partial issue as a warning rather than a success', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ invoice: { id: 'invoice-3' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 207,
        json: async () => ({ warning: 'Invoice 2026-0004 was issued but not emailed' }),
      })
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & send/ }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-3')
  })

  it('keeps the work when the draft cannot be created', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'One or more charges are already on an invoice' }),
    })
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Save draft/ }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent)
        .toContain('One or more charges are already on an invoice'))
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('explains an empty charge list rather than showing a blank form', () => {
    renderComposer({ initialCharges: [] })

    expect(screen.getByText(/no uninvoiced charges/i)).toBeTruthy()
  })

  it('keeps every control at the 44px touch target', () => {
    renderComposer()

    for (const name of [/Save draft/, /Issue & send/]) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11')
    }
    expect(screen.getByLabelText('Issue date').className).toContain('min-h-11')
  })
})
