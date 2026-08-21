import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const admin = getAdminClient()
  const { data: payment, error } = await admin.from('billing_payments')
    .select('invoice_id, payment_group_id').eq('id', (await params).id).maybeSingle()
  if (error || !payment?.invoice_id) return NextResponse.json({ error: error?.message ?? 'Invoice payment not found' }, { status: 404 })
  const invoice = await reloadInvoice(payment.invoice_id)
  const recipient = invoice.billToEmail ?? invoice.clientEmail
  if (!recipient) return NextResponse.json({ error: 'The client has no email address' }, { status: 409 })
  const rendered = await renderAndAttachInvoice(invoice, auth.userId!)
  const result = await emailInvoice({
    invoice, rendered, to: recipient,
    message: 'Payment received. This paid or partially paid invoice is your receipt. Thank you.',
    actorId: auth.userId!,
  })
  if (result.status !== 'sent') return NextResponse.json({ error: result.reason ?? 'Receipt sending is disabled' }, { status: 409 })
  await Promise.all([
    admin.from('payment_receipts').update({ status: 'sent', sent_by: auth.userId, sent_at: new Date().toISOString() }).eq('payment_group_id', payment.payment_group_id),
    admin.from('billing_events').insert({ invoice_id: invoice.id, event_type: 'receipt_sent', actor_id: auth.userId, detail: 'Manual payment receipt sent' }),
  ])
  return NextResponse.json({ sent: true })
}
