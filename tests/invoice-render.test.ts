import PizZip from 'pizzip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceRenderData } from '@/lib/invoices/types'

const ORIGINAL_CONVERT_URL = process.env.DOCX_PDF_CONVERT_URL

function renderData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  return {
    firm: {
      name: 'Aubrey Law',
      attorneyName: 'Scott Aubrey',
      street: '100 Great Plain Ave',
      cityStateZip: 'Needham, MA 02492',
      phone: '(781) 555-0100',
      email: 'scott@aubreylegal.com',
      website: 'aubreylegal.com',
      barNumber: '123456',
    },
    billTo: {
      name: 'Marcus Chen',
      email: 'chen@example.com',
      matterName: 'Chen Joint Trust',
      matterNumber: '2026-EP-Chen-014',
    },
    invoiceNumber: '2026-0004',
    issueDate: 'September 30, 2026',
    dueDate: 'October 30, 2026',
    dueDateKey: '2026-10-30',
    lines: [
      { description: 'Flat fee — Joint trust package', kind: 'flat_fee', amount: '$2,000.00' },
      { description: 'Deed recording fee', kind: 'cost', amount: '$450.00' },
    ],
    subtotal: '$2,450.00',
    paymentsApplied: null,
    balanceDue: '$2,450.00',
    notes: null,
    terms: null,
    payLink: null,
    remitTo: 'Aubrey Law · 100 Great Plain Ave · Needham, MA 02492',
    ...overrides,
  }
}

/** Every text run in the document body, concatenated. */
function documentText(docxBytes: Buffer): string {
  const xml = new PizZip(docxBytes).file('word/document.xml')?.asText() ?? ''
  return xml.replace(/<[^>]+>/g, '')
}

describe('invoice DOCX generation', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DOCX_PDF_CONVERT_URL
  })

  afterEach(() => {
    if (ORIGINAL_CONVERT_URL === undefined) delete process.env.DOCX_PDF_CONVERT_URL
    else process.env.DOCX_PDF_CONVERT_URL = ORIGINAL_CONVERT_URL
  })

  it('produces a real Word file carrying every line and total exactly once', async () => {
    const { generateInvoiceArtifact } = await import('@/lib/invoices/generate')
    const artifact = await generateInvoiceArtifact(renderData(), 'Marcus Chen')

    expect(artifact.docxBytes.subarray(0, 2).toString()).toBe('PK')
    expect(artifact.docxBytes.byteLength).toBeGreaterThan(5_000)

    const text = documentText(artifact.docxBytes)
    expect(text.split('2026-0004')).toHaveLength(2)
    expect(text.split('Flat fee — Joint trust package')).toHaveLength(2)
    expect(text.split('Deed recording fee')).toHaveLength(2)
    expect(text).toContain('Balance due')
    // Subtotal and balance are both $2,450.00 here, so the figure appears twice.
    expect(text.split('$2,450.00')).toHaveLength(3)
  })

  it('names the file from the invoice number and the client surname', async () => {
    const { generateInvoiceArtifact } = await import('@/lib/invoices/generate')
    const artifact = await generateInvoiceArtifact(renderData(), 'Chen, Marcus & Lily')

    expect(artifact.baseName).toBe('Invoice_2026-0004_Lily')
  })

  it('carries the pay link and the notes when they are set', async () => {
    const { generateInvoiceArtifact } = await import('@/lib/invoices/generate')
    const artifact = await generateInvoiceArtifact(
      renderData({
        payLink: 'https://pay.example.com/inv/2026-0004',
        notes: 'Thank you for your business.',
        terms: 'Payment due within 30 days.',
      }),
      'Marcus Chen',
    )

    const text = documentText(artifact.docxBytes)
    expect(text).toContain('https://pay.example.com/inv/2026-0004')
    expect(text).toContain('Thank you for your business.')
    expect(text).toContain('Payment due within 30 days.')
  })

  it('degrades to DOCX-only rather than throwing when the converter is unconfigured', async () => {
    // Issuing must never block on DOCX_PDF_CONVERT_URL: the email carries the
    // whole invoice inline regardless.
    const { generateInvoiceArtifact } = await import('@/lib/invoices/generate')
    const artifact = await generateInvoiceArtifact(renderData(), 'Marcus Chen')

    expect(artifact.pdfBytes).toBeNull()
    expect(artifact.pdfUnavailableReason).toContain('DOCX_PDF_CONVERT_URL')
  })
})

describe('invoice email body', () => {
  it('escapes a charge description rather than letting it become markup', async () => {
    const { buildInvoiceEmailHtml } = await import('@/lib/invoices/emailBody')
    const html = buildInvoiceEmailHtml(renderData({
      lines: [{
        description: '<script>alert("x")</script> & "quoted"',
        kind: 'cost',
        amount: '$10.00',
      }],
    }))

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;quoted&quot;')
  })

  it('renders the whole invoice inline so a blocked attachment still reads', async () => {
    const { buildInvoiceEmailHtml } = await import('@/lib/invoices/emailBody')
    const html = buildInvoiceEmailHtml(renderData())

    expect(html).toContain('Invoice 2026-0004')
    expect(html).toContain('Flat fee — Joint trust package')
    expect(html).toContain('Balance due')
    expect(html).toContain('$2,450.00')
    // A bare fragment, so sendEmail can brand-wrap it.
    expect(html).not.toContain('<!DOCTYPE')
  })

  it('shows a pay button only when there is a link', async () => {
    const { buildInvoiceEmailHtml } = await import('@/lib/invoices/emailBody')

    expect(buildInvoiceEmailHtml(renderData())).not.toContain('Pay this invoice')
    expect(buildInvoiceEmailHtml(renderData({ payLink: 'https://pay.example.com/x' })))
      .toContain('Pay this invoice')
  })

  it('renders the balance in the destructive tone when past due', async () => {
    const { buildInvoiceEmailHtml } = await import('@/lib/invoices/emailBody')
    const html = buildInvoiceEmailHtml(renderData(), { pastDue: true })

    expect(html).toContain('#b42318')
  })

  it('provides a plain-text fallback with the same figures', async () => {
    const { buildInvoiceEmailText } = await import('@/lib/invoices/emailBody')
    const text = buildInvoiceEmailText(renderData())

    expect(text).toContain('Invoice 2026-0004')
    expect(text).toContain('Balance due: $2,450.00')
    expect(text).toContain('Deed recording fee')
  })
})
