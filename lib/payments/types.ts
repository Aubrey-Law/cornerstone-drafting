export const paymentProviders = ['stripe', 'lawpay'] as const
export type PaymentProvider = (typeof paymentProviders)[number]

export interface CheckoutSessionInput {
  invoiceId: string
  invoiceNumber: string
  /** Integer cents, matching the rest of billing. */
  amountCents: number
  clientEmail: string | null
  description: string
  successUrl: string
  cancelUrl: string
}

export interface CheckoutSession {
  sessionId: string
  checkoutUrl: string
  expiresAt: string | null
}

export interface RefundResult {
  refundId: string
  status: string
}

/**
 * The events we act on. Anything else parses to null and is acknowledged
 * without processing — a provider sends far more than an invoice cares about,
 * and silently 200-ing the rest is what keeps them from retrying forever.
 */
export type PaymentWebhookEvent =
  | {
    type: 'checkout.completed'
    eventId: string
    sessionId: string
    paymentIntentId: string | null
    amountCents: number
    processorFeeCents: number
    receivedAt: string
  }
  | {
    type: 'checkout.expired' | 'checkout.failed'
    eventId: string
    sessionId: string
  }
  | {
    type: 'payment.adjustment'
    eventId: string
    paymentIntentId: string
    externalReference: string
    amountCents: number
    kind: 'refund' | 'dispute'
    balanceEffect: 'credit' | 'debit' | null
    reason: string | null
    metadata: Record<string, string>
  }

/**
 * One payment processor behind one interface.
 *
 * Swapping providers is meant to cost an env var and a file, not a rewrite of
 * the routes — which is why the routes never see a provider-specific type.
 */
export interface PaymentProcessor {
  readonly id: PaymentProvider
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>
  lookupProcessorFee?(paymentIntentId: string): Promise<number>
  refundPayment?(input: { paymentIntentId: string; amountCents: number; invoiceId: string }): Promise<RefundResult>
  /** Verified against the raw request body — never a re-serialized object. */
  verifySignature(rawBody: string, headers: Headers): boolean
  parseEvent(rawBody: string): PaymentWebhookEvent | null
}
