import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPaymentProcessor: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/lib/payments', () => ({ getPaymentProcessor: mocks.getPaymentProcessor }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc: mocks.rpc }) }))

import { POST as webhook } from '@/app/api/webhooks/payments/route'

const completedEvent = {
  type: 'checkout.completed' as const,
  eventId: 'evt_1',
  sessionId: 'cs_1',
  paymentIntentId: 'pi_1',
  amountCents: 245_000,
  processorFeeCents: 0,
  receivedAt: '2026-08-17T12:00:00.000Z',
}

function processor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stripe',
    createCheckoutSession: vi.fn(),
    verifySignature: vi.fn().mockReturnValue(true),
    parseEvent: vi.fn().mockReturnValue(completedEvent),
    ...overrides,
  }
}

const request = () => new Request('http://app.test/api/webhooks/payments', {
  method: 'POST',
  body: JSON.stringify({ id: 'evt_1' }),
})

describe('payments webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPaymentProcessor.mockReturnValue(processor())
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  it('503s when no processor is configured', async () => {
    mocks.getPaymentProcessor.mockReturnValue(null)
    expect((await webhook(request())).status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('401s on a bad signature, before touching the database', async () => {
    mocks.getPaymentProcessor.mockReturnValue(
      processor({ verifySignature: vi.fn().mockReturnValue(false) }),
    )
    expect((await webhook(request())).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('verifies against the raw body, not a re-serialized object', async () => {
    const p = processor()
    mocks.getPaymentProcessor.mockReturnValue(p)
    const body = JSON.stringify({ id: 'evt_1', extra: '  spacing  matters  ' })
    await webhook(new Request('http://app.test/api/webhooks/payments', { method: 'POST', body }))

    expect(p.verifySignature).toHaveBeenCalledWith(body, expect.any(Headers))
  })

  it('acknowledges an event type it does not handle rather than retrying forever', async () => {
    mocks.getPaymentProcessor.mockReturnValue(
      processor({ parseEvent: vi.fn().mockReturnValue(null) }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await webhook(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, ignored: true })
    // Logged, so the gap is visible rather than silent.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('records the payment once the claim is won', async () => {
    const response = await webhook(request())

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('claim_webhook_event', expect.objectContaining({
      p_provider: 'stripe',
      p_event_id: 'evt_1',
      // Identifiers only — never card data.
      p_payload: { session_id: 'cs_1' },
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('complete_invoice_checkout_session', expect.objectContaining({
      p_session_id: 'cs_1',
      p_amount_cents: 245_000,
    }))
  })

  it('no-ops on a duplicate delivery', async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === 'claim_webhook_event'
        ? Promise.resolve({ data: false, error: null })
        : Promise.resolve({ data: null, error: null }))

    const response = await webhook(request())

    expect(await response.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when recording fails, so the retry can succeed', async () => {
    // Without the release, a failed attempt would be deduped away and the
    // payment would never be recorded at all.
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === 'claim_webhook_event') return Promise.resolve({ data: true, error: null })
      if (fn === 'complete_invoice_checkout_session') {
        return Promise.resolve({ data: null, error: { message: 'boom' } })
      }
      return Promise.resolve({ data: null, error: null })
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await webhook(request())

    expect(response.status).toBe(500)
    expect(mocks.rpc).toHaveBeenCalledWith('release_webhook_event', {
      p_provider: 'stripe',
      p_event_id: 'evt_1',
    })
    error.mockRestore()
  })

  it('closes the session on a terminal non-payment outcome', async () => {
    mocks.getPaymentProcessor.mockReturnValue(processor({
      parseEvent: vi.fn().mockReturnValue({
        type: 'checkout.expired', eventId: 'evt_9', sessionId: 'cs_9',
      }),
    }))

    await webhook(request())

    expect(mocks.rpc).toHaveBeenCalledWith('close_invoice_checkout_session', {
      p_provider: 'stripe',
      p_session_id: 'cs_9',
      p_status: 'expired',
    })
  })
})
