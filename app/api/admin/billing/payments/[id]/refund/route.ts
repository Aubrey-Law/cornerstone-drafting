import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getPaymentProcessor } from '@/lib/payments'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }
const schema = z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(3).max(500) })

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const body = schema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'A positive refund amount and reason are required' }, { status: 400 })
  const processor = getPaymentProcessor()
  if (!processor || processor.id !== 'stripe' || !processor.refundPayment) return NextResponse.json({ error: 'Stripe refunds are unavailable' }, { status: 503 })

  const admin = getAdminClient()
  const { data: payment, error } = await admin
    .from('billing_payments')
    .select('invoice_id, payment_group_id, amount, external_reference')
    .eq('id', (await params).id)
    .maybeSingle()
  if (error || !payment?.invoice_id || !payment.external_reference) {
    return NextResponse.json({ error: error?.message ?? 'Online payment not found' }, { status: 404 })
  }
  const { data: groupRows } = await admin.from('billing_payments').select('amount').eq('payment_group_id', payment.payment_group_id)
  const paid = (groupRows ?? []).reduce((sum, row) => sum + row.amount, 0)
  if (body.data.amountCents > paid) return NextResponse.json({ error: 'Refund exceeds this payment' }, { status: 409 })

  try {
    const refund = await processor.refundPayment({
      paymentIntentId: payment.external_reference,
      amountCents: body.data.amountCents,
      invoiceId: payment.invoice_id,
    })
    const { data, error: recordError } = await admin.rpc('record_payment_adjustment', {
      p_invoice_id: payment.invoice_id,
      p_payment_group_id: payment.payment_group_id,
      p_kind: 'refund',
      p_amount_cents: body.data.amountCents,
      p_balance_effect: 'debit',
      p_reason: body.data.reason,
      p_provider: 'stripe',
      p_external_reference: refund.refundId,
      p_metadata: { status: refund.status },
      p_actor_id: auth.userId,
    })
    if (recordError) throw new Error(recordError.message)
    return NextResponse.json({ refund: data }, { status: 201 })
  } catch (refundError) {
    return NextResponse.json({ error: refundError instanceof Error ? refundError.message : 'Refund failed' }, { status: 409 })
  }
}
