import 'server-only'

import {
  convertDocxToPdf,
  DocxPdfConvertNotConfiguredError,
  isDocxPdfConvertConfigured,
} from '@/lib/docxPdfConvert'
import { loadFirmSettings } from '@/lib/firmSettings'
import type { Invoice, InvoiceLine } from '@/lib/billing/invoices'
import generateInvoiceDocx from '@/lib/invoices/templates/invoice'
import type { InvoiceArtifact, InvoiceRenderData } from './types'

type TemplateGenerator = (data: Record<string, unknown>) => Promise<Buffer>

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function money(cents: number): string {
  return MONEY.format(cents / 100)
}

/** A YYYY-MM-DD key rendered in the firm's timezone, e.g. "September 30, 2026". */
function displayDate(key: string | null): string {
  if (!key) return '—'
  const parsed = new Date(`${key}T12:00:00`)
  return Number.isNaN(parsed.valueOf())
    ? key
    : new Intl.DateTimeFormat('en-US', {
      dateStyle: 'long',
      timeZone: 'America/New_York',
    }).format(parsed)
}

/** `Chen` from `Michael and Susan Chen`, for the filename. */
function fileTag(clientName: string): string {
  const cleaned = clientName.replace(/[^A-Za-z0-9 ]/g, '').trim()
  const last = cleaned.split(/\s+/).pop()
  return last && last.length > 1 ? last : 'Client'
}

/**
 * Assembles the render model. Exported so the composer preview and the email
 * body build from exactly the same numbers the PDF does.
 */
export async function buildInvoiceRenderData(input: {
  invoice: Invoice
  lines: InvoiceLine[]
  collected: number
  matterName?: string | null
}): Promise<InvoiceRenderData> {
  const firm = await loadFirmSettings()
  const { invoice, lines, collected } = input
  const cityStateZip = [firm.city, firm.state].filter(Boolean).join(', ')
  const remitParts = [
    firm.firmName,
    firm.street,
    [cityStateZip, firm.zip].filter(Boolean).join(' '),
    firm.phone,
    firm.email,
  ].filter(Boolean)

  return {
    firm: {
      name: firm.firmName,
      attorneyName: firm.attorneyName,
      street: firm.street,
      cityStateZip: [cityStateZip, firm.zip].filter(Boolean).join(' '),
      phone: firm.phone,
      email: firm.email,
      website: firm.website,
      barNumber: firm.barNumber,
    },
    billTo: {
      name: invoice.billToName ?? invoice.clientName,
      email: invoice.billToEmail ?? invoice.clientEmail,
      matterName: input.matterName ?? null,
      matterNumber: invoice.matterNumber,
    },
    // A draft has no number yet; the preview says so rather than showing blank.
    invoiceNumber: invoice.number ?? 'Draft — not yet issued',
    issueDate: displayDate(invoice.issueDate),
    dueDate: displayDate(invoice.dueDate),
    dueDateKey: invoice.dueDate ?? '',
    lines: lines.map(line => ({
      description: line.description,
      kind: line.kind,
      amount: money(line.amountCents),
    })),
    subtotal: money(invoice.subtotalCents),
    paymentsApplied: collected > 0 ? `− ${money(collected)}` : null,
    balanceDue: money(Math.max(0, invoice.subtotalCents - collected)),
    notes: invoice.notes,
    terms: invoice.terms,
    payLink: invoice.paymentLink,
    remitTo: remitParts.join(' · '),
  }
}

/**
 * Renders the invoice to DOCX and, when the convert worker is configured, PDF.
 *
 * A missing PDF is a first-class outcome, not an error: issuing must never
 * block on DOCX_PDF_CONVERT_URL being set, because the email carries the full
 * invoice inline regardless and the client can always read it. A worker that
 * is configured but broken *is* an error and propagates.
 */
export async function generateInvoiceArtifact(
  data: InvoiceRenderData,
  clientName: string,
): Promise<InvoiceArtifact> {
  const numberTag = data.invoiceNumber.replace(/[^A-Za-z0-9-]/g, '_')
  const baseName = `Invoice_${numberTag}_${fileTag(clientName)}`
  const docxBytes = await (generateInvoiceDocx as unknown as TemplateGenerator)(
    data as unknown as Record<string, unknown>,
  )

  if (!isDocxPdfConvertConfigured()) {
    return {
      baseName,
      docxBytes,
      pdfBytes: null,
      pdfUnavailableReason: new DocxPdfConvertNotConfiguredError().message,
    }
  }

  try {
    const pdfBytes = await convertDocxToPdf(docxBytes, `${baseName}.docx`)
    return { baseName, docxBytes, pdfBytes, pdfUnavailableReason: null }
  } catch (error) {
    if (error instanceof DocxPdfConvertNotConfiguredError) {
      return { baseName, docxBytes, pdfBytes: null, pdfUnavailableReason: error.message }
    }
    throw error
  }
}
