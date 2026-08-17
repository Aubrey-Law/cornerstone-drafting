import { NextResponse } from 'next/server'
import { getPaymentProcessor } from '@/lib/payments'
import { getAdminClient } from '@/lib/supabaseAdmin'

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
    p_payload: { session_id: event.sessionId },
  })
  if (claimError) {
    console.error('[payments] claim failed:', claimError.message)
    return NextResponse.json({ error: 'claim failed' }, { status: 500 })
  }
  if (claimed === false) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  try {
    if (event.type === 'checkout.completed') {
      const { error } = await admin.rpc('complete_invoice_checkout_session', {
        p_provider: processor.id,
        p_session_id: event.sessionId,
        p_payment_intent_id: event.paymentIntentId,
        p_amount_cents: event.amountCents,
        p_processor_fee_cents: event.processorFeeCents,
        p_received_at: event.receivedAt,
      })
      if (error) throw new Error(error.message)
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
