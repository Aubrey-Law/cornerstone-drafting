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
    payer: 'client',
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

function renderDetail(
  overrides: Partial<InvoiceDetail> = {},
  options: { pdfConversionEnabled?: boolean; paymentsEnabled?: boolean } = {},
) {
  return render(
    <InvoiceDetailClient
      invoice={invoice(overrides)}
      firm={{ name: 'Aubrey Law', remitTo: 'Aubrey Law · Needham, MA' }}
      paymentsEnabled={options.paymentsEnabled ?? false}
      pdfConversionEnabled={options.pdfConversionEnabled ?? false}
    />,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

async function openInvoiceActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /More invoice actions/ }))
}

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
  it('issues a carrier draft without sending it, and offers no email afterwards', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ sent: false, invoice: { number: '2026-0007' } }),
    })
    const { unmount } = renderDetail({ payer: 'metlife', billToName: 'MetLife Legal Plans', billToEmail: null })
    expect(screen.getByText('Billed to MetLife Legal Plans')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Issue & send/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Issue invoice' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ send: false })
    unmount()

    renderDetail({ payer: 'metlife', status: 'issued', number: '2026-0007', issuedAt: '2026-10-02T12:00:00Z' })
    await openInvoiceActions(user)
    expect(screen.queryByRole('menuitem', { name: /Send invoice|Resend invoice/ })).toBeNull()
  })

  it('offers both issue actions on a draft', async () => {
    const user = userEvent.setup()
    renderDetail()
    expect(screen.getByRole('button', { name: /Issue & send/ })).toBeTruthy()
    await openInvoiceActions(user)
    expect(screen.getByRole('menuitem', { name: /Issue & download/ })).toBeTruthy()
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

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /Issue & download/ }))

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

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /Issue & download/ }))

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

  it('drops the issue actions once the invoice is issued', async () => {
    const user = userEvent.setup()
    renderDetail({ status: 'issued', number: '2026-0004', issuedAt: '2026-08-17T12:00:00.000Z' })

    expect(screen.queryByRole('button', { name: /Issue & send/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Issue & download/ })).toBeNull()
    await openInvoiceActions(user)
    expect(screen.getByRole('menuitem', { name: /^Send invoice$/ })).toBeTruthy()
  })

  // The RPCs behind both of these shipped with the invoice schema, but nothing
  // in the UI called them: a draft could only be issued or abandoned in place.
  it('links a draft to its editor', async () => {
    const user = userEvent.setup()
    renderDetail()

    await openInvoiceActions(user)
    expect(screen.getByRole('link', { name: /^Edit draft$/ }).getAttribute('href'))
      .toBe('/admin/billing/invoices/inv-1/edit')
  })

  it('offers no editor once the invoice is issued', async () => {
    const user = userEvent.setup()
    renderDetail({ status: 'issued', number: '2026-0004' })

    expect(screen.queryByRole('link', { name: /^Edit draft$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Discard$/ })).toBeNull()
    await openInvoiceActions(user)
    // Void is the issued-invoice equivalent: it keeps the number on the record.
    expect(screen.getByRole('menuitem', { name: /^Void invoice$/ })).toBeTruthy()
  })

  it('confirms before discarding, naming what goes back to the ledger', async () => {
    const user = userEvent.setup()
    renderDetail()

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /^Discard draft$/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('1 charge')
    expect(dialog.textContent).toContain('$2,450.00')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discards the draft and returns to the invoice list', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    renderDetail()

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /^Discard draft$/ }))
    await user.click(await screen.findByRole('button', { name: /Discard draft/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/billing/invoices/inv-1')
    expect(init.method).toBe('DELETE')
    expect(navigation.push).toHaveBeenCalledWith('/admin/billing/invoices')
  })

  // The banner used to hardcode "the Word version was sent instead" and blame
  // the converter, both of which can be false.
  it('does not claim the Word file was emailed when it never was', () => {
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      sentAt: null,
      pdfDocumentId: null,
      docxDocumentId: 'doc-docx',
    })

    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Downloading it gives you the Word file')
    expect(banner.textContent).not.toContain('emailed')
  })

  it('says the Word file is what went out when the invoice was emailed', () => {
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      sentAt: '2026-08-17T13:00:00.000Z',
      pdfDocumentId: null,
      docxDocumentId: 'doc-docx',
    })

    expect(screen.getByRole('status').textContent).toContain('That is what was emailed')
  })

  it('offers no retry, and names the cause, when the converter is down', () => {
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      pdfDocumentId: null,
      docxDocumentId: 'doc-docx',
    })

    expect(screen.getByRole('status').textContent).toContain('not reachable')
    expect(screen.queryByRole('button', { name: /Generate PDF/ })).toBeNull()
  })

  // A killed render leaves an issued invoice with nothing attached. Telling the
  // attorney they have "only the Word version" points them at a file that is
  // not there.
  it('separates a render that never finished from a PDF that was skipped', () => {
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      pdfDocumentId: null,
      docxDocumentId: null,
    })

    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('No document was produced')
    expect(banner.textContent).not.toContain('only the Word version')
  })

  it('offers the retry with no documents at all, even with the converter down', () => {
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      pdfDocumentId: null,
      docxDocumentId: null,
    })

    // The Word file needs no converter, so there is always something to retry.
    expect(screen.getByRole('button', { name: /Generate document/ })).toBeTruthy()
  })

  it('offers a retry once the converter is available', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ invoice: { id: 'inv-1' }, pdfUnavailableReason: null }),
    })
    renderDetail(
      {
        status: 'issued',
        number: '2026-0004',
        pdfDocumentId: null,
        docxDocumentId: 'doc-docx',
      },
      { pdfConversionEnabled: true },
    )

    expect(screen.getByRole('status').textContent).toContain('converter is available now')
    await user.click(screen.getByRole('button', { name: /Generate PDF/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/billing/invoices/inv-1/document')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(toast.success).toHaveBeenCalledWith('PDF generated')
    expect(navigation.refresh).toHaveBeenCalled()
  })

  it('shows no banner at all once the invoice has a PDF', () => {
    renderDetail({ status: 'issued', number: '2026-0004', pdfDocumentId: 'doc-pdf' })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says the download is the Word version rather than letting it pass silently', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        sent: false,
        pdfUnavailableReason: 'DOCX→PDF conversion is not configured.',
        invoice: { number: '2026-0004', pdfDocumentId: null, docxDocumentId: 'doc-docx' },
      }),
    })
    renderDetail()

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /Issue & download/ }))

    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(toast.warning).toHaveBeenCalledWith(
      'No PDF could be produced, so this is the Word version.',
    )
    expect(download.mock.calls[0][0]).toMatchObject({ documentId: 'doc-docx', isPdf: false })
  })

  it('keeps the draft when the discard is refused', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Only a draft invoice can be discarded' }),
    })
    renderDetail()

    await openInvoiceActions(user)
    await user.click(screen.getByRole('menuitem', { name: /^Discard draft$/ }))
    await user.click(await screen.findByRole('button', { name: /Discard draft/ }))

    await waitFor(() => expect(toast.error)
      .toHaveBeenCalledWith('Only a draft invoice can be discarded'))
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('keeps one draft primary action and moves secondary actions into a menu', async () => {
    const user = userEvent.setup()
    renderDetail()

    expect(screen.getByRole('button', { name: /^Issue & send$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Issue & download$/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Edit$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Discard$/ })).toBeNull()

    await openInvoiceActions(user)

    expect(await screen.findByRole('link', { name: /^Edit draft$/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Issue & download$/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Discard draft$/ })).toBeTruthy()
  })

  it('reviews an overdue reminder before sending it', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ sent: true }))
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      issuedAt: '2026-08-17T12:00:00.000Z',
      sentAt: '2026-08-17T13:00:00.000Z',
      dueDate: '2026-08-31',
      overdue: true,
      daysPastDue: 28,
      lastRemindedAt: '2026-09-14T14:30:00.000Z',
      pdfDocumentId: 'doc-pdf',
    })

    expect(screen.queryByRole('button', { name: /^Send reminder$/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Review reminder$/ }))

    const dialog = await screen.findByRole('dialog', { name: /Review payment reminder/ })
    expect(dialog.textContent).toContain('chen@example.com')
    expect(dialog.textContent).toContain('Firm')
    expect(dialog.textContent).toContain('Invoice PDF attached')
    expect(dialog.textContent).toContain('Last reminder')
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^Send reminder$/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tone: 'firm',
      attachInvoice: true,
    })
  })

  it('uses record payment as the primary action when an open invoice is not overdue', async () => {
    const user = userEvent.setup()
    renderDetail({
      status: 'issued',
      number: '2026-0004',
      issuedAt: '2026-08-17T12:00:00.000Z',
      pdfDocumentId: 'doc-pdf',
    }, { paymentsEnabled: true })

    expect(screen.getByRole('button', { name: /^Record payment$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Create pay link$/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /More invoice actions/ }))
    expect(await screen.findByRole('menuitem', { name: /^Send invoice$/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Create pay link$/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Void invoice$/ })).toBeTruthy()
  })
})
