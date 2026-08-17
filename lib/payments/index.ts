import { lawpayProcessor } from './lawpay'
import { stripeProcessor } from './stripe'
import { paymentProviders, type PaymentProcessor, type PaymentProvider } from './types'

export * from './types'

/**
 * The configured processor, or null when online payment is switched off.
 *
 * Null is the default and a first-class state: with no PAYMENTS_PROVIDER the
 * checkout route 503s and the Pay-link button never renders, so the firm keeps
 * pasting a link by hand exactly as it did before.
 */
export function getPaymentProcessor(): PaymentProcessor | null {
  const provider = process.env.PAYMENTS_PROVIDER?.trim() as PaymentProvider | undefined
  if (!provider || !(paymentProviders as readonly string[]).includes(provider)) return null

  if (provider === 'lawpay') return lawpayProcessor()

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  // A provider named but not configured is a deployment mistake, not an
  // intent to disable payments — say so rather than silently going quiet.
  if (!secretKey || !webhookSecret) {
    console.error('[payments] PAYMENTS_PROVIDER=stripe but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is unset')
    return null
  }
  return stripeProcessor(secretKey, webhookSecret)
}

export function isPaymentProcessorConfigured(): boolean {
  return getPaymentProcessor() !== null
}
