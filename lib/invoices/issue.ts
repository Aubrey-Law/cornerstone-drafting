import 'server-only'

import { randomUUID } from 'node:crypto'
import { putFileToR2 } from '@/lib/documentUpload'
import { MAX_TOTAL_ATTACHMENT_BYTES } from '@/lib/email/attachments'
import { sendEmail } from '@/lib/email/send'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchInvoice } from '@/lib/queries/invoices'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { InvoiceDetail } from '@/lib/billing/invoices'
import { buildInvoiceEmailHtml, buildInvoiceEmailText } from './emailBody'
import { buildInvoiceRenderData, generateInvoiceArtifact } from './generate'
import type { InvoiceRenderData } from './types'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface StoredDocument {
  id: string
  name: string
  bytes: Buffer
  contentType: string
}

/**
 * Puts one rendered artifact in R2 and records it against the matter.
 *
 * shared_at is stamped so the client sees it in the portal Documents list
 * through the existing visibility rule — no separate sharing step, and no new
 * document plumbing.
 */
async function storeArtifact(input: {
  matterId: string
  invoiceId: string
  name: string
  bytes: Buffer
  contentType: string
  extension: string
}): Promise<StoredDocument> {
  const admin = getAdminClient()
  // The uuid suffix keeps a re-render from colliding with the object it
  // replaces, so the old PDF stays retrievable from its own document row.
  const key = `matters/${input.matterId}/invoices/${input.invoiceId}-${randomUUID()}.${input.extension}`
  await putFileToR2(key, input.bytes, input.contentType)

  const { data, error } = await admin
    .from('matter_documents')
    .insert({
      matter_id: input.matterId,
      r2_key: key,
      name: input.name,
      size: input.bytes.byteLength,
      content_type: input.contentType,
      folder: 'client',
      source: 'firm',
      shared_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  return { id: data.id as string, name: input.name, bytes: input.bytes, contentType: input.contentType }
}

export interface RenderedInvoice {
  pdf: StoredDocument | null
  docx: StoredDocument
  renderData: InvoiceRenderData
  /** Set when the convert worker is unconfigured, so the UI can say so. */
  pdfUnavailableReason: string | null
}

/**
 * Renders an issued invoice and attaches the artifacts.
 *
 * Called after issue_invoice, never before: the document has to carry the
 * number, and holding the numbering lock across the convert worker's HTTP call
 * would serialize every other issue behind it.
 */
export async function renderAndAttachInvoice(
  invoice: InvoiceDetail,
  actorId: string,
): Promise<RenderedInvoice> {
  const renderData = await buildInvoiceRenderData({
    invoice,
    lines: invoice.lines,
    collected: invoice.collected,
  })
  const artifact = await generateInvoiceArtifact(renderData, invoice.clientName)

  const docx = await storeArtifact({
    matterId: invoice.matterId,
    invoiceId: invoice.id,
    name: `${artifact.baseName}.docx`,
    bytes: artifact.docxBytes,
    contentType: DOCX_MIME,
    extension: 'docx',
  })

  const pdf = artifact.pdfBytes
    ? await storeArtifact({
      matterId: invoice.matterId,
      invoiceId: invoice.id,
      name: `${artifact.baseName}.pdf`,
      bytes: artifact.pdfBytes,
      contentType: 'application/pdf',
      extension: 'pdf',
    })
    : null

  const { error } = await getAdminClient().rpc('attach_invoice_documents', {
    p_invoice_id: invoice.id,
    p_pdf_document_id: pdf?.id ?? null,
    p_docx_document_id: docx.id,
    p_actor_id: actorId,
  })
  if (error) throw new Error(error.message)

  return { pdf, docx, renderData, pdfUnavailableReason: artifact.pdfUnavailableReason }
}

export interface SendInvoiceResult {
  status: 'sent' | 'skipped'
  reason?: string
}

/**
 * Emails the invoice. The body carries the whole invoice inline, so a client
 * whose mail client blocks the attachment can still read what they owe; the
 * PDF (or the DOCX, when conversion is unavailable) rides along.
 */
export async function emailInvoice(input: {
  invoice: InvoiceDetail
  rendered: RenderedInvoice
  to: string
  cc?: string[]
  message?: string | null
  actorId: string
  reminder?: boolean
}): Promise<SendInvoiceResult> {
  const { invoice, rendered } = input
  const firm = await loadFirmSettings()
  const attachment = rendered.pdf ?? rendered.docx
  const subject = input.reminder
    ? `Reminder: invoice ${invoice.number} from ${firm.firmName}`
    : `Invoice ${invoice.number} from ${firm.firmName}`

  const result = await sendEmail({
    category: input.reminder ? 'invoice_reminder' : 'invoice_sent',
    to: input.to,
    cc: input.cc,
    subject,
    html: buildInvoiceEmailHtml(rendered.renderData, {
      intro: input.message ?? null,
      pastDue: Boolean(input.reminder) || invoice.overdue,
    }),
    text: buildInvoiceEmailText(rendered.renderData, { intro: input.message ?? null }),
    // An invoice PDF is tens of kilobytes, but check anyway: Graph rejects
    // bodies over ~4MB and a silent provider error is worse than sending the
    // invoice inline without the attachment.
    attachments: attachment.bytes.byteLength <= MAX_TOTAL_ATTACHMENT_BYTES
      ? [{
        filename: attachment.name,
        content: attachment.bytes,
        contentType: attachment.contentType,
      }]
      : [],
    matterId: invoice.matterId,
    userId: input.actorId,
  })

  if (!result.ok) return { status: 'skipped', reason: result.error }
  if (result.status === 'suppressed') return { status: 'skipped', reason: result.reason }
  return { status: 'sent' }
}

/**
 * Timeline entry for the matter. Best effort: a failure here must never undo
 * an invoice that has already gone out.
 */
export async function logInvoiceActivity(input: {
  matterId: string
  eventType: 'invoice_issued' | 'invoice_paid'
  title: string
  detail: string
  actorId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await getAdminClient().from('matter_activity').insert({
      matter_id: input.matterId,
      event_type: input.eventType,
      title: input.title,
      detail: input.detail,
      actor_id: input.actorId,
      metadata: input.metadata ?? null,
    })
  } catch {
    // Intentionally swallowed — see the doc comment.
  }
}

/** Re-reads the invoice after a mutation so callers return server truth. */
export async function reloadInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const invoice = await fetchInvoice(invoiceId)
  if (!invoice) throw new Error('Invoice not found')
  return invoice
}
