import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { billingFailure } from '@/lib/billing/apiFailure'
import { invoiceIdSchema, recordInvoicePaymentSchema } from '@/lib/billing/invoices'
import { logInvoiceActivity, reloadInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Context = { params: Promise<{ id: string }> }

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * Records one client payment against the invoice. The RPC allocates it across
 * the invoice's charges oldest first, so the per-charge ledger stays correct
 * without the caller having to know how the money splits.
 */
export async function POST(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsedId = invoiceIdSchema.safeParse((await context.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })

  const parsed = recordInvoicePaymentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payment' }, { status: 400 })
  }

  const { error } = await getAdminClient().rpc('record_invoice_payment', {
    p_invoice_id: parsedId.data,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_note: parsed.data.note ?? null,
    p_received_at: parsed.data.receivedAt ?? null,
    p_actor_id: auth.userId,
    p_external_reference: parsed.data.externalReference ?? null,
    p_processor_fee_cents: 0,
  })
  if (error) return billingFailure(error)

  const invoice = await reloadInvoice(parsedId.data)
  if (invoice.status === 'paid') {
    await logInvoiceActivity({
      matterId: invoice.matterId,
      eventType: 'invoice_paid',
      title: `Invoice ${invoice.number} paid in full`,
      detail: MONEY.format(invoice.subtotalCents / 100),
      actorId: auth.userId,
      metadata: { invoice_id: invoice.id, number: invoice.number },
    })
  }

  return NextResponse.json({ invoice })
}
