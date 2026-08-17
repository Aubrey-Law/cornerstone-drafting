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
const download = vi.hoisted(() => vi.fn())
vi.mock('@/lib/invoices/downloadInvoice', () => ({ downloadInvoiceDocument: download }))

import { InvoiceComposer } from '@/components/billing/InvoiceComposer'

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

// Radix Select needs these in jsdom before its listbox will open.
if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
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
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ send: true })
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-1')
    expect(toast.success).toHaveBeenCalledWith('Invoice issued and emailed')
  })

  it('issues without emailing and hands back the PDF', async () => {
    // For a bill given to the client in person or posted, rather than emailed.
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ invoice: { id: 'invoice-9' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sent: false,
          invoice: { number: '2026-0009', pdfDocumentId: 'doc-9', docxDocumentId: 'docx-9' },
        }),
      })
    download.mockResolvedValue(undefined)
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & download/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ send: false })
    await waitFor(() => expect(download).toHaveBeenCalledWith({
      documentId: 'doc-9',
      invoiceNumber: '2026-0009',
      isPdf: true,
    }))
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-9')
  })

  it('falls back to the Word file when no PDF was produced', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ invoice: { id: 'invoice-10' } }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sent: false,
          invoice: { number: '2026-0010', pdfDocumentId: null, docxDocumentId: 'docx-10' },
        }),
      })
    download.mockResolvedValue(undefined)
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & download/ }))

    await waitFor(() => expect(download).toHaveBeenCalledWith({
      documentId: 'docx-10',
      invoiceNumber: '2026-0010',
      isPdf: false,
    }))
  })

  it('still counts the invoice as issued when the download itself fails', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ invoice: { id: 'invoice-11' } }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sent: false,
          invoice: { number: '2026-0011', pdfDocumentId: 'doc-11', docxDocumentId: null },
        }),
      })
    download.mockRejectedValue(new Error('network'))
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & download/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Invoice issued, but the download could not start',
    ))
    // The invoice exists regardless, so the user still lands on it.
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices/invoice-11')
  })

  it('keeps emailing on the send action', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ invoice: { id: 'invoice-12' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sent: true }) })
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Issue & send/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ send: true })
    expect(download).not.toHaveBeenCalled()
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

  describe('editing a saved draft', () => {
    const INVOICE_ID = '33333333-3333-4333-8333-333333333333'

    const draft = {
      invoiceId: INVOICE_ID,
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      notes: 'Thank you for your business.',
      terms: null,
      billToName: 'Marcus Chen',
      billToEmail: 'marcus@example.com',
      paymentLink: null,
      orphanedLineCount: 0,
    }

    function renderEditor(overrides: Record<string, unknown> = {}) {
      return renderComposer({
        preselectedChargeIds: [FEE_ID],
        draft: { ...draft, ...overrides },
      })
    }

    it('seeds the form from the draft rather than from today', () => {
      renderEditor()

      expect(screen.getByRole('heading', { name: 'Edit draft invoice' })).toBeTruthy()
      expect((screen.getByLabelText('Issue date') as HTMLInputElement).value).toBe('2026-09-01')
      expect((screen.getByLabelText(/Bill to/) as HTMLInputElement).value).toBe('Marcus Chen')
      expect((screen.getByLabelText(/Send to/) as HTMLInputElement).value)
        .toBe('marcus@example.com')
      expect((screen.getByLabelText(/^Notes/) as HTMLTextAreaElement).value)
        .toBe('Thank you for your business.')
    })

    it('restores exactly the charges the draft holds, not every open charge', () => {
      renderEditor()

      expect((screen.getByLabelText('Flat fee — Joint trust package') as HTMLInputElement)
        .getAttribute('data-state')).toBe('checked')
      expect((screen.getByLabelText('Deed recording fee') as HTMLInputElement)
        .getAttribute('data-state')).toBe('unchecked')
      expect(screen.getByText('1 of 2 selected')).toBeTruthy()
    })

    it('fixes the matter, because a draft cannot move between matters', () => {
      renderEditor()

      expect(screen.getByLabelText('Matter').hasAttribute('disabled')).toBe(true)
      expect(screen.getByText(/Discard this draft to bill a different matter/)).toBeTruthy()
    })

    it('saves changes with PATCH onto the existing invoice', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ invoice: { id: INVOICE_ID } }),
      })
      renderEditor()

      await user.click(screen.getByLabelText('Deed recording fee'))
      await user.click(screen.getByRole('button', { name: /Save changes/ }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`/api/admin/billing/invoices/${INVOICE_ID}`)
      expect(init.method).toBe('PATCH')
      const body = JSON.parse(init.body)
      // No matterId: the RPC cannot move an invoice, so sending one would lie.
      expect(body.matterId).toBeUndefined()
      expect(body.itemIds).toEqual([FEE_ID, COST_ID])
      expect(body.issueDate).toBe('2026-09-01')
      expect(toast.success).toHaveBeenCalledWith('Draft invoice updated')
      expect(navigation.push).toHaveBeenCalledWith(`/admin/billing/invoices/${INVOICE_ID}`)
    })

    it('saves the edit before issuing, so the sent invoice is the edited one', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ invoice: { id: INVOICE_ID } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sent: true }),
        })
      renderEditor()

      await user.click(screen.getByRole('button', { name: /Issue & send/ }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
      expect(fetchMock.mock.calls[1][0])
        .toBe(`/api/admin/billing/invoices/${INVOICE_ID}/issue`)
      expect(toast.success).toHaveBeenCalledWith('Invoice issued and emailed')
    })

    it('keeps a due date that matches no term instead of snapping it to Net 30', () => {
      renderEditor({ dueDate: '2026-09-20' })

      expect(screen.getByText('Due 2026-09-20')).toBeTruthy()
      expect(screen.getByLabelText('Payment terms').textContent).toContain('Custom')
    })

    it('re-derives the due date once a real term is chosen', async () => {
      const user = userEvent.setup()
      renderEditor({ dueDate: '2026-09-20' })

      await user.click(screen.getByLabelText('Payment terms'))
      await user.click(screen.getByRole('option', { name: 'Net 15' }))

      await waitFor(() => expect(screen.getByText('Due 2026-09-16')).toBeTruthy())
    })

    it('warns when a line points at a charge that has since been deleted', () => {
      renderEditor({ orphanedLineCount: 1 })

      expect(screen.getByRole('status').textContent)
        .toContain('refers to a charge that has since been deleted')
    })

    it('surfaces a rejected edit without navigating away', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Only a draft invoice can be edited' }),
      })
      renderEditor()

      await user.click(screen.getByRole('button', { name: /Save changes/ }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('Only a draft invoice can be edited'))
      expect(navigation.push).not.toHaveBeenCalled()
    })
  })
})
