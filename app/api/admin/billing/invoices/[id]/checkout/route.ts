import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, isCarrierInvoice } from '@/lib/billing/invoices'
import { reloadInvoice } from '@/lib/invoices/issue'
import { getPaymentProcessor } from '@/lib/payments'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { portalUrl } from '@/lib/urls'

type Context = { params: Promise<{ id: string }> }

const createCheckoutSchema = z.object({
  /** Defaults to the whole outstanding balance; a partial payment is allowed. */
  amount: z.number().int().positive().optional(),
})

/**
 * Opens a hosted checkout and puts its link on the invoice.
 *
 * Storing the URL on `invoices.payment_link` is what makes it appear on the
 * PDF, as the Pay button in the email, and in the client portal — one field,
 * three surfaces, no extra plumbing.
 */
export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const processor = getPaymentProcessor()
  if (!processor) {
    return NextResponse.json(
      { error: 'Online payment is not configured. Set PAYMENTS_PROVIDER to enable it.' },
      { status: 503 },
    )
  }

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const parsed = createCheckoutSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const invoice = await reloadInvoice(parsedId.data)
  if (isCarrierInvoice(invoice)) {
    return NextResponse.json(
      { error: 'This invoice bills a legal plan carrier and is kept as an internal record; it cannot be paid online' },
      { status: 409 },
    )
  }
  if (invoice.status === 'draft' || invoice.status === 'void') {
    return NextResponse.json({ error: 'Only an issued invoice can be paid online' }, { status: 409 })
  }
  if (invoice.balance <= 0) {
    return NextResponse.json({ error: 'This invoice is already paid' }, { status: 409 })
  }

  const amount = parsed.data.amount ?? invoice.balance
  if (amount > invoice.balance) {
    return NextResponse.json({ error: 'That is more than the invoice balance' }, { status: 409 })
  }

  let session
  try {
    session = await processor.createCheckoutSession({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number ?? '',
      amountCents: amount,
      clientEmail: invoice.billToEmail ?? invoice.clientEmail,
      description: `Invoice ${invoice.number ?? ''}`.trim(),
      successUrl: portalUrl('/dashboard?paid=1'),
      cancelUrl: portalUrl('/dashboard'),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not open a checkout session' },
      { status: 502 },
    )
  }

  const { error } = await getAdminClient().rpc('record_invoice_checkout_session', {
    p_invoice_id: invoice.id,
    p_provider: processor.id,
    p_session_id: session.sessionId,
    p_amount_cents: amount,
    p_checkout_url: session.checkoutUrl,
    p_expires_at: session.expiresAt,
    p_actor_id: auth.userId,
  })
  if (error) return billingFailure(error)

  return NextResponse.json({
    invoice: await reloadInvoice(parsedId.data),
    checkoutUrl: session.checkoutUrl,
  }, { status: 201 })
}
