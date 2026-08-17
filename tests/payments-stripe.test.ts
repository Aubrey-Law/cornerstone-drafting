import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stripeProcessor } from '@/lib/payments/stripe'

const SECRET = 'whsec_test'
const processor = stripeProcessor('sk_test', SECRET)

function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return new Headers({ 'stripe-signature': `t=${timestamp},v1=${signature}` })
}

const completed = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', amount_total: 245_000, payment_intent: 'pi_1' } },
})

describe('stripe signature verification', () => {
  it('accepts a signature over the exact raw body', () => {
    expect(processor.verifySignature(completed, sign(completed))).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    // The whole point of signing the raw body: a re-serialized or edited
    // payload must not verify.
    const tampered = completed.replace('245000', '1')
    expect(processor.verifySignature(tampered, sign(completed))).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    expect(processor.verifySignature(completed, sign(completed, 'whsec_other'))).toBe(false)
  })

  it('rejects a stale timestamp, so a captured request cannot be replayed later', () => {
    const stale = Math.floor(Date.now() / 1000) - 3_600
    expect(processor.verifySignature(completed, sign(completed, SECRET, stale))).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    expect(processor.verifySignature(completed, new Headers())).toBe(false)
    expect(processor.verifySignature(completed, new Headers({ 'stripe-signature': 'nonsense' })))
      .toBe(false)
    expect(processor.verifySignature(completed, new Headers({ 'stripe-signature': 't=123' })))
      .toBe(false)
  })

  it('accepts any one of several v1 signatures, as sent during secret rotation', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const good = createHmac('sha256', SECRET).update(`${timestamp}.${completed}`).digest('hex')
    const headers = new Headers({
      'stripe-signature': `t=${timestamp},v1=${'0'.repeat(64)},v1=${good}`,
    })
    expect(processor.verifySignature(completed, headers)).toBe(true)
  })

  it('does not throw on a signature of the wrong length', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const headers = new Headers({ 'stripe-signature': `t=${timestamp},v1=abc` })
    expect(() => processor.verifySignature(completed, headers)).not.toThrow()
    expect(processor.verifySignature(completed, headers)).toBe(false)
  })
})

describe('stripe event parsing', () => {
  it('reads a completed checkout', () => {
    expect(processor.parseEvent(completed)).toMatchObject({
      type: 'checkout.completed',
      eventId: 'evt_1',
      sessionId: 'cs_1',
      paymentIntentId: 'pi_1',
      amountCents: 245_000,
      processorFeeCents: 0,
    })
  })

  it('reads the terminal non-payment outcomes', () => {
    const expired = JSON.stringify({
      id: 'evt_2',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_2' } },
    })
    expect(processor.parseEvent(expired)).toEqual({
      type: 'checkout.expired', eventId: 'evt_2', sessionId: 'cs_2',
    })
  })

  it('ignores event types this integration does not handle', () => {
    // Refunds and disputes arrive here and are deliberately not acted on yet.
    const refund = JSON.stringify({
      id: 'evt_3',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1' } },
    })
    expect(processor.parseEvent(refund)).toBeNull()
  })

  it('ignores malformed or incomplete payloads', () => {
    expect(processor.parseEvent('not json')).toBeNull()
    expect(processor.parseEvent(JSON.stringify({ type: 'checkout.session.completed' }))).toBeNull()
    expect(processor.parseEvent(JSON.stringify({
      id: 'evt_4',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_4', amount_total: 0 } },
    }))).toBeNull()
  })
})

describe('stripe checkout session creation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the amount in cents and carries the invoice id through metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cs_new', url: 'https://pay.test/cs_new', expires_at: 1_800_000_000 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const session = await processor.createCheckoutSession({
      invoiceId: 'inv-1',
      invoiceNumber: '2026-0004',
      amountCents: 245_000,
      clientEmail: 'chen@example.com',
      description: 'Invoice 2026-0004',
      successUrl: 'https://portal.test/dashboard?paid=1',
      cancelUrl: 'https://portal.test/dashboard',
    })

    expect(session).toEqual({
      sessionId: 'cs_new',
      checkoutUrl: 'https://pay.test/cs_new',
      expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    })
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('245000')
    expect(body.get('metadata[invoice_id]')).toBe('inv-1')
    expect(body.get('customer_email')).toBe('chen@example.com')
  })

  it('surfaces the provider error rather than a bare status code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: { message: 'Your card was declined' } }),
    }))

    await expect(processor.createCheckoutSession({
      invoiceId: 'inv-1',
      invoiceNumber: '2026-0004',
      amountCents: 100,
      clientEmail: null,
      description: 'Invoice',
      successUrl: 'https://portal.test/a',
      cancelUrl: 'https://portal.test/b',
    })).rejects.toThrow('Your card was declined')
  })
})

describe('processor selection', () => {
  const saved = { ...process.env }
  beforeEach(() => vi.resetModules())
  afterEach(() => { process.env = { ...saved } })

  it('is off by default, so nothing renders until it is configured', async () => {
    delete process.env.PAYMENTS_PROVIDER
    const { getPaymentProcessor } = await import('@/lib/payments')
    expect(getPaymentProcessor()).toBeNull()
  })

  it('stays off when the provider is named but its keys are missing', async () => {
    process.env.PAYMENTS_PROVIDER = 'stripe'
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getPaymentProcessor } = await import('@/lib/payments')

    expect(getPaymentProcessor()).toBeNull()
    // A half-configured provider is a deployment mistake worth saying out loud.
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('returns Stripe once fully configured', async () => {
    process.env.PAYMENTS_PROVIDER = 'stripe'
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    const { getPaymentProcessor } = await import('@/lib/payments')
    expect(getPaymentProcessor()?.id).toBe('stripe')
  })

  it('refuses to half-work when LawPay is selected', async () => {
    process.env.PAYMENTS_PROVIDER = 'lawpay'
    const { getPaymentProcessor } = await import('@/lib/payments')
    const lawpay = getPaymentProcessor()

    expect(lawpay?.id).toBe('lawpay')
    expect(lawpay?.verifySignature('{}', new Headers())).toBe(false)
    await expect(lawpay!.createCheckoutSession({
      invoiceId: 'inv-1',
      invoiceNumber: '1',
      amountCents: 1,
      clientEmail: null,
      description: 'x',
      successUrl: 'x',
      cancelUrl: 'x',
    })).rejects.toThrow(/not implemented/i)
  })
})
