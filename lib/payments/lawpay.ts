import type { PaymentProcessor } from './types'

/**
 * LawPay behind the same interface, unimplemented.
 *
 * It exists so choosing LawPay is a matter of filling in three methods and
 * flipping PAYMENTS_PROVIDER, rather than discovering that the routes were
 * written around Stripe's shape. Every method fails loudly: a half-working
 * payment integration is worse than an absent one.
 */
export function lawpayProcessor(): PaymentProcessor {
  return {
    id: 'lawpay',
    // Rejects rather than throwing synchronously: the interface declares a
    // Promise, and a sync throw from a declared-async method escapes any
    // caller that handles failure with .catch().
    createCheckoutSession: () => Promise.reject(new Error(
      'LawPay checkout is not implemented yet. Set PAYMENTS_PROVIDER=stripe, or implement lib/payments/lawpay.ts.',
    )),
    lookupProcessorFee: () => Promise.reject(new Error('LawPay is not implemented')),
    refundPayment: () => Promise.reject(new Error('LawPay is not implemented')),
    verifySignature: () => false,
    parseEvent: () => null,
  }
}
