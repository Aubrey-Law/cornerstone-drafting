import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, issueInvoiceSchema } from '@/lib/billing/invoices'
import {
  emailInvoice,
  logInvoiceActivity,
  reloadInvoice,
  renderAndAttachInvoice,
} from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

/**
 * Matches the 120s ceiling convertDocxToPdf allows the worker. Without it the
 * platform default cuts the function off mid-conversion, and because the number
 * is assigned first that leaves a real issued invoice carrying no documents at
 * all — the worst of the three outcomes, and the hardest to read from the UI.
 */
export const maxDuration = 120

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * Issues the invoice, then renders and (optionally) emails it.
 *
 * Ordering matters: issue_invoice assigns the number in a short transaction,
 * and only then is the document rendered with that number in hand. A render or
 * send failure therefore leaves a real, numbered invoice that can be retried,
 * rather than rolling back and burning a number out of the year's series.
 */
export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const parsed = issueInvoiceSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { error } = await getAdminClient().rpc('issue_invoice', {
    p_invoice_id: parsedId.data,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  const invoice = await reloadInvoice(parsedId.data)

  let rendered
  try {
    rendered = await renderAndAttachInvoice(invoice, auth.userId)
  } catch (renderError) {
    // The invoice is issued and numbered; only the document is missing.
    return NextResponse.json({
      invoice,
      warning: renderError instanceof Error
        ? `Invoice ${invoice.number} was issued but the document could not be produced: ${renderError.message}`
        : `Invoice ${invoice.number} was issued but the document could not be produced.`,
    }, { status: 207 })
  }

  await logInvoiceActivity({
    matterId: invoice.matterId,
    eventType: 'invoice_issued',
    title: `Invoice ${invoice.number} issued`,
    detail: `${MONEY.format(invoice.subtotalCents / 100)} due ${invoice.dueDate ?? 'on receipt'}`,
    actorId: auth.userId,
    metadata: { invoice_id: invoice.id, number: invoice.number },
  })

  if (!parsed.data.send) {
    return NextResponse.json({
      invoice: await reloadInvoice(parsedId.data),
      sent: false,
      pdfUnavailableReason: rendered.pdfUnavailableReason,
    })
  }

  const to = parsed.data.to ?? invoice.billToEmail ?? invoice.clientEmail
  if (!to) {
    return NextResponse.json({
      invoice,
      sent: false,
      warning: `Invoice ${invoice.number} was issued, but there is no email address on file to send it to.`,
    }, { status: 207 })
  }

  const sendResult = await emailInvoice({
    invoice,
    rendered,
    to,
    cc: parsed.data.cc,
    message: parsed.data.message ?? null,
    actorId: auth.userId,
  })

  if (sendResult.status === 'sent') {
    const { error: sentError } = await getAdminClient().rpc('mark_invoice_sent', {
      p_invoice_id: parsedId.data,
      p_channel: 'email',
      p_recipient: to,
      p_actor_id: auth.userId,
    })
    if (sentError) return billingFailure(sentError)
  }

  return NextResponse.json({
    invoice: await reloadInvoice(parsedId.data),
    sent: sendResult.status === 'sent',
    warning: sendResult.status === 'skipped'
      ? `Invoice ${invoice.number} was issued but not emailed: ${sendResult.reason ?? 'sending is switched off'}`
      : undefined,
    pdfUnavailableReason: rendered.pdfUnavailableReason,
  })
}
