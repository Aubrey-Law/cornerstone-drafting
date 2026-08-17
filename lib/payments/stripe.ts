import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  CheckoutSession,
  CheckoutSessionInput,
  PaymentProcessor,
  PaymentWebhookEvent,
} from './types'

const API = 'https://api.stripe.com/v1'

/**
 * How far apart the signature timestamp and our clock may be. Stripe's own
 * guidance; it bounds how long a captured request stays replayable.
 */
const TOLERANCE_SECONDS = 300

/**
 * Implemented against Stripe's REST API rather than the SDK: the surface used
 * here is two calls and a signature check, and the SDK is a large dependency
 * to carry for that.
 */
export function stripeProcessor(secretKey: string, webhookSecret: string): PaymentProcessor {
  return {
    id: 'stripe',

    async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
      const form = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(input.amountCents),
        'line_items[0][price_data][product_data][name]': input.description,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.invoiceId,
        'metadata[invoice_id]': input.invoiceId,
        'metadata[invoice_number]': input.invoiceNumber,
      })
      if (input.clientEmail) form.set('customer_email', input.clientEmail)

      const response = await fetch(`${API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      })
      const json = await response.json().catch(() => ({})) as {
        id?: string
        url?: string
        expires_at?: number
        error?: { message?: string }
      }
      if (!response.ok || !json.id || !json.url) {
        throw new Error(json.error?.message ?? `Stripe returned HTTP ${response.status}`)
      }

      return {
        sessionId: json.id,
        checkoutUrl: json.url,
        expiresAt: json.expires_at ? new Date(json.expires_at * 1000).toISOString() : null,
      }
    },

    verifySignature(rawBody: string, headers: Headers): boolean {
      const header = headers.get('stripe-signature')
      if (!header) return false

      // `t=<unix>,v1=<hex>[,v1=<hex>…]` — several v1 entries appear while a
      // secret is being rotated, and any one matching is a valid signature.
      let timestamp = ''
      const signatures: string[] = []
      for (const part of header.split(',')) {
        const [key, value] = part.split('=')
        if (key?.trim() === 't') timestamp = value?.trim() ?? ''
        if (key?.trim() === 'v1' && value) signatures.push(value.trim())
      }
      if (!timestamp || signatures.length === 0) return false

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
      if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex')
      const expectedBuffer = Buffer.from(expected, 'utf8')

      return signatures.some(signature => {
        const candidate = Buffer.from(signature, 'utf8')
        // timingSafeEqual throws on a length mismatch, which is itself a
        // non-match, so guard rather than let it escape as a 500.
        return candidate.length === expectedBuffer.length
          && timingSafeEqual(candidate, expectedBuffer)
      })
    },

    parseEvent(rawBody: string): PaymentWebhookEvent | null {
      let event: {
        id?: string
        type?: string
        data?: { object?: Record<string, unknown> }
      }
      try {
        event = JSON.parse(rawBody)
      } catch {
        return null
      }
      const object = event.data?.object ?? {}
      const sessionId = typeof object.id === 'string' ? object.id : null
      if (!event.id || !sessionId) return null

      if (event.type === 'checkout.session.completed') {
        const amount = Number(object.amount_total)
        if (!Number.isInteger(amount) || amount <= 0) return null
        return {
          type: 'checkout.completed',
          eventId: event.id,
          sessionId,
          paymentIntentId: typeof object.payment_intent === 'string' ? object.payment_intent : null,
          amountCents: amount,
          // The fee lives on the balance transaction, a second API call away.
          // It is recorded, never subtracted, so leaving it at zero costs
          // accuracy in reporting and nothing in what the client owes.
          processorFeeCents: 0,
          receivedAt: new Date().toISOString(),
        }
      }

      if (event.type === 'checkout.session.expired') {
        return { type: 'checkout.expired', eventId: event.id, sessionId }
      }
      if (event.type === 'checkout.session.async_payment_failed') {
        return { type: 'checkout.failed', eventId: event.id, sessionId }
      }

      return null
    },
  }
}
