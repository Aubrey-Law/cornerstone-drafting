// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InvoiceDetail } from '@/lib/billing/invoices'

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
const download = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navigation.refresh, push: navigation.push }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'access-token' }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/invoices/downloadInvoice', () => ({ downloadInvoiceDocument: download }))

import InvoiceDetailClient from '@/app/admin/billing/invoices/[id]/InvoiceDetailClient'

function invoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: 'inv-1',
    matterId: 'matter-1',
    number: null,
    numberYear: null,
    kind: 'invoice',
    status: 'draft',
    subtotalCents: 245_000,
    issueDate: '2026-08-17',
    dueDate: '2026-09-16',
    notes: null,
    terms: null,
    billToName: 'Chen, Marcus',
    billToEmail: 'chen@example.com',
    paymentLink: null,
    issuedAt: null,
    sentAt: null,
    lastRemindedAt: null,
    paidAt: null,
    voidedAt: null,
    voidReason: null,
    pdfDocumentId: null,
    docxDocumentId: null,
    createdAt: '2026-08-17T12:00:00.000Z',
    clientName: 'Chen, Marcus',
    clientEmail: 'chen@example.com',
    matterNumber: '2026-EP-Chen-014',
    lines: [{
      id: 'line-1',
      billingItemId: 'item-1',
      position: 0,
      kind: 'flat_fee',
      description: 'Flat fee — Trust package',
      amountCents: 245_000,
    }],
    payments: [],
    collected: 0,
    balance: 245_000,
    overdue: false,
    daysPastDue: 0,
    ...overrides,
  }
}

function renderDetail(overrides: Partial<InvoiceDetail> = {}) {
  return render(
    <InvoiceDetailClient
      invoice={invoice(overrides)}
      firm={{ name: 'Aubrey Law', remitTo: 'Aubrey Law · Needham, MA' }}
      paymentsEnabled={false}
    />,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

describe('issuing from the invoice detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // Before this existed, a saved draft had no action on its own page at all —
  // the only way to issue was the composer you had already left.
  it('offers both issue actions on a draft', () => {
    renderDetail()
    expect(screen.getByRole('button', { name: /Issue & send/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Issue & download/ })).toBeTruthy()
  })

  it('issues and emails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ sent: true }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: /Issue & send/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/billing/invoices/inv-1/issue',
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ send: true })
    expect(toast.success).toHaveBeenCalledWith('Invoice issued and emailed')
    expect(download).not.toHaveBeenCalled()
  })

  it('issues without emailing and downloads the document', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({
      sent: false,
      invoice: { number: '2026-0004', pdfDocumentId: 'doc-4', docxDocumentId: null },
    }))
    download.mockResolvedValue(undefined)
    renderDetail()

    await user.click(screen.getByRole('button', { name: /Issue & download/ }))

    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ send: false }))
    await waitFor(() => expect(download).toHaveBeenCalledWith({
      documentId: 'doc-4',
      invoiceNumber: '2026-0004',
      isPdf: true,
    }))
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('warns rather than silently doing nothing when no document exists to download', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({
      sent: false,
      invoice: { number: '2026-0005', pdfDocumentId: null, docxDocumentId: null },
    }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: /Issue & download/ }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Invoice issued, but no document was produced to download',
    ))
    expect(download).not.toHaveBeenCalled()
  })

  it('surfaces a failure to issue and leaves the draft alone', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      Response.json({ error: 'An invoice must total more than zero' }, { status: 409 }),
    )
    renderDetail()

    await user.click(screen.getByRole('button', { name: /Issue & send/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'An invoice must total more than zero',
    ))
  })

  it('drops the issue actions once the invoice is issued', () => {
    renderDetail({ status: 'issued', number: '2026-0004', issuedAt: '2026-08-17T12:00:00.000Z' })

    expect(screen.queryByRole('button', { name: /Issue & send/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Issue & download/ })).toBeNull()
    // Replaced by the post-issue actions.
    expect(screen.getByRole('button', { name: /^Send$/ })).toBeTruthy()
  })

  // The RPCs behind both of these shipped with the invoice schema, but nothing
  // in the UI called them: a draft could only be issued or abandoned in place.
  it('links a draft to its editor', () => {
    renderDetail()

    expect(screen.getByRole('link', { name: /^Edit$/ }).getAttribute('href'))
      .toBe('/admin/billing/invoices/inv-1/edit')
  })

  it('offers no editor once the invoice is issued', () => {
    renderDetail({ status: 'issued', number: '2026-0004' })

    expect(screen.queryByRole('link', { name: /^Edit$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Discard$/ })).toBeNull()
    // Void is the issued-invoice equivalent: it keeps the number on the record.
    expect(screen.getByRole('button', { name: /^Void$/ })).toBeTruthy()
  })

  it('confirms before discarding, naming what goes back to the ledger', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: /^Discard$/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('1 charge')
    expect(dialog.textContent).toContain('$2,450.00')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discards the draft and returns to the invoice list', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    renderDetail()

    await user.click(screen.getByRole('button', { name: /^Discard$/ }))
    await user.click(await screen.findByRole('button', { name: /Discard draft/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/billing/invoices/inv-1')
    expect(init.method).toBe('DELETE')
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices')
  })

  it('keeps the draft when the discard is refused', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Only a draft invoice can be discarded' }),
    })
    renderDetail()

    await user.click(screen.getByRole('button', { name: /^Discard$/ }))
    await user.click(await screen.findByRole('button', { name: /Discard draft/ }))

    await waitFor(() => expect(toast.error)
      .toHaveBeenCalledWith('Only a draft invoice can be discarded'))
    expect(navigation.push).not.toHaveBeenCalled()
  })
})
