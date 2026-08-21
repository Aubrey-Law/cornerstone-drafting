import { NextResponse } from 'next/server'
import { getPaymentProcessor } from '@/lib/payments'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { emailInvoice, reloadInvoice, renderAndAttachInvoice } from '@/lib/invoices/issue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Payment provider callbacks.
 *
 * Ordering is deliberate: verify the signature over the raw body, claim the
 * event so a retry cannot record the money twice, then record it — and release
 * the claim if recording fails, so the provider's retry can succeed rather
 * than being deduped away by a claim for work that never happened.
 */
export async function POST(req: Request) {
  const processor = getPaymentProcessor()
  if (!processor) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  // Read once, as text. A re-serialized object will not match the signature.
  const rawBody = await req.text()

  if (!processor.verifySignature(rawBody, req.headers)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = processor.parseEvent(rawBody)
  if (!event) {
    // Refunds, disputes, and everything else this integration does not handle
    // yet. Logged so the gap is visible rather than silent, and 200 so the
    // provider stops retrying something we will never act on.
    console.warn('[payments] unhandled webhook event')
    return NextResponse.json({ received: true, ignored: true })
  }

  const admin = getAdminClient()
  const { data: claimed, error: claimError } = await admin.rpc('claim_webhook_event', {
    p_provider: processor.id,
    p_event_id: event.eventId,
    p_event_type: event.type,
    // Identifiers only — never card data or the full provider payload.
    p_payload: event.type === 'payment.adjustment'
      ? { payment_intent_id: event.paymentIntentId, external_reference: event.externalReference }
      : { session_id: event.sessionId },
  })
  if (claimError) {
    console.error('[payments] claim failed:', claimError.message)
    return NextResponse.json({ error: 'claim failed' }, { status: 500 })
  }
  if (claimed === false) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  try {
    if (event.type === 'payment.adjustment') {
      const { data: payment, error: paymentError } = await admin.from('billing_payments')
        .select('invoice_id, payment_group_id').eq('external_reference', event.paymentIntentId).limit(1).maybeSingle()
      if (paymentError || !payment?.invoice_id) throw new Error(paymentError?.message ?? 'Original payment not found')
      if (event.metadata.stripe_event === 'charge.dispute.closed') {
        const openedReference = event.externalReference.replace(/:closed$/, ':opened')
        const finalStatus = event.metadata.status === 'won' ? 'reversed' : 'posted'
        const { error } = await admin.from('billing_adjustments')
          .update({ status: finalStatus, updated_at: new Date().toISOString() })
          .eq('provider', processor.id)
          .eq('external_reference', openedReference)
          .eq('status', 'pending')
        if (error) throw new Error(error.message)
        await admin.from('billing_events').insert({
          invoice_id: payment.invoice_id,
          event_type: 'dispute_closed',
          detail: `Stripe dispute closed: ${event.metadata.status ?? 'unknown'}`,
          metadata: { external_reference: event.externalReference, ...event.metadata },
        })
      } else if (event.balanceEffect) {
        const { error } = await admin.rpc('record_payment_adjustment', {
          p_invoice_id: payment.invoice_id,
          p_payment_group_id: payment.payment_group_id,
          p_kind: event.kind,
          p_amount_cents: event.amountCents,
          p_balance_effect: event.balanceEffect,
          p_reason: event.reason,
          p_provider: processor.id,
          p_external_reference: event.externalReference,
          p_metadata: event.metadata,
          p_actor_id: null,
        })
        if (error) throw new Error(error.message)
      }
    } else if (event.type === 'checkout.completed') {
      const processorFeeCents = event.paymentIntentId && processor.lookupProcessorFee
        ? await processor.lookupProcessorFee(event.paymentIntentId).catch(error => {
            console.error('[payments] fee lookup failed:', error)
            return 0
          })
        : 0
      const { error } = await admin.rpc('complete_invoice_checkout_session', {
        p_provider: processor.id,
        p_session_id: event.sessionId,
        p_payment_intent_id: event.paymentIntentId,
        p_amount_cents: event.amountCents,
        p_processor_fee_cents: processorFeeCents,
        p_received_at: event.receivedAt,
      })
      if (error) throw new Error(error.message)

      // A verified provider payment earns an automatic receipt. Email failure
      // is visible in logs but never rolls back money already recorded.
      try {
        const { data: session } = await admin.from('invoice_checkout_sessions')
          .select('invoice_id').eq('provider', processor.id).eq('provider_session_id', event.sessionId).single()
        if (session?.invoice_id) {
          const invoice = await reloadInvoice(session.invoice_id)
          const recipient = invoice.billToEmail ?? invoice.clientEmail
          const { data: actor } = await admin.from('users').select('id').in('role', ['attorney', 'admin']).limit(1).maybeSingle()
          if (recipient && actor?.id) {
            const rendered = await renderAndAttachInvoice(invoice, actor.id)
            const receipt = await emailInvoice({
              invoice, rendered, to: recipient,
              message: 'Payment received. This paid invoice is your receipt. Thank you.',
              actorId: actor.id,
            })
            if (receipt.status === 'sent') {
              await admin.from('billing_events').insert({ invoice_id: invoice.id, event_type: 'receipt_sent', detail: 'Online payment receipt sent' })
            }
          }
        }
      } catch (receiptError) {
        console.error('[payments] receipt failed:', receiptError)
      }
    } else {
      const { error } = await admin.rpc('close_invoice_checkout_session', {
        p_provider: processor.id,
        p_session_id: event.sessionId,
        p_status: event.type === 'checkout.expired' ? 'expired' : 'failed',
      })
      if (error) throw new Error(error.message)
    }
  } catch (error) {
    await admin.rpc('release_webhook_event', {
      p_provider: processor.id,
      p_event_id: event.eventId,
    })
    console.error('[payments] processing failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'processing failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
