import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { invoiceIdSchema } from '@/lib/billing/invoices'
import { reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'

type Context = { params: Promise<{ id: string }> }

/**
 * Re-renders an issued invoice's documents and attaches them.
 *
 * Exists because the PDF is optional at issue time: when the DOCX→PDF worker
 * is unreachable the invoice still issues, carrying only the Word file. Without
 * this the invoice would stay Word-only for good, even after the worker came
 * back. `attach_invoice_documents` coalesces, so a retry only ever adds.
 *
 * The invoice keeps its number and its issue date — this replaces the file,
 * not the bill.
 */
export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const invoice = await reloadInvoice(parsedId.data)
  if (invoice.status === 'draft') {
    return NextResponse.json(
      { error: 'Issue the invoice before producing its document' },
      { status: 409 },
    )
  }
  if (invoice.status === 'void') {
    return NextResponse.json(
      { error: 'This invoice is void — reissue it rather than re-rendering it' },
      { status: 409 },
    )
  }

  let rendered
  try {
    rendered = await renderAndAttachInvoice(invoice, auth.userId)
  } catch (renderError) {
    return NextResponse.json({
      error: renderError instanceof Error
        ? `The document could not be produced: ${renderError.message}`
        : 'The document could not be produced.',
    }, { status: 502 })
  }

  return NextResponse.json({
    invoice: await reloadInvoice(parsedId.data),
    pdfUnavailableReason: rendered.pdfUnavailableReason,
  })
}
