import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))

import {
  shouldApplyStatus,
  verifyResendWebhookSignature,
} from '@/lib/email/resendWebhook'
import { POST as webhook } from '@/app/api/webhooks/resend/route'

// A real Svix secret is `whsec_` + base64. The HMAC key is the DECODED bytes.
const KEY = Buffer.from('cornerstone-resend-webhook-test-key')
const SECRET = `whsec_${KEY.toString('base64')}`

function sign(body: string, id: string, timestamp: number, key: Buffer = KEY): string {
  const mac = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${mac}`
}

const NOW_MS = 1_770_000_000_000
const NOW_S = Math.floor(NOW_MS / 1000)

describe('verifyResendWebhookSignature', () => {
  const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e1' } })
  const base = { payload: body, svixId: 'msg_1', svixTimestamp: String(NOW_S), secret: SECRET, nowMs: NOW_MS }

  it('accepts a correctly signed delivery', () => {
    expect(verifyResendWebhookSignature({
      ...base, svixSignature: sign(body, 'msg_1', NOW_S),
    })).toBe(true)
  })

  it('derives the key from the decoded secret, not the printable string', () => {
    // Signing with the literal `whsec_…` text must NOT verify. If this passes,
    // the implementation skipped base64-decoding and every signature is being
    // checked against the wrong key.
    const wrong = sign(body, 'msg_1', NOW_S, Buffer.from(SECRET))
    expect(verifyResendWebhookSignature({ ...base, svixSignature: wrong })).toBe(false)
  })

  it('rejects a tampered body', () => {
    const signature = sign(body, 'msg_1', NOW_S)
    const tampered = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } })
    expect(verifyResendWebhookSignature({
      ...base, payload: tampered, svixSignature: signature,
    })).toBe(false)
  })

  it('rejects a signature replayed under a different message id', () => {
    // svix-id is part of the signed content, so a captured signature cannot be
    // re-presented as a new delivery.
    expect(verifyResendWebhookSignature({
      ...base, svixId: 'msg_2', svixSignature: sign(body, 'msg_1', NOW_S),
    })).toBe(false)
  })

  it('rejects a stale timestamp, and a far-future one', () => {
    const stale = NOW_S - 6 * 60
    expect(verifyResendWebhookSignature({
      ...base, svixTimestamp: String(stale), svixSignature: sign(body, 'msg_1', stale),
    })).toBe(false)

    const future = NOW_S + 6 * 60
    expect(verifyResendWebhookSignature({
      ...base, svixTimestamp: String(future), svixSignature: sign(body, 'msg_1', future),
    })).toBe(false)
  })

  it('accepts one valid signature among several during secret rotation', () => {
    const header = `v1,${Buffer.from('stale').toString('base64')} ${sign(body, 'msg_1', NOW_S)}`
    expect(verifyResendWebhookSignature({ ...base, svixSignature: header })).toBe(true)
  })

  it('rejects missing headers and a blank secret', () => {
    expect(verifyResendWebhookSignature({ ...base, svixSignature: null })).toBe(false)
    expect(verifyResendWebhookSignature({ ...base, svixId: null, svixSignature: sign(body, 'msg_1', NOW_S) })).toBe(false)
    expect(verifyResendWebhookSignature({ ...base, secret: '   ', svixSignature: sign(body, 'msg_1', NOW_S) })).toBe(false)
  })
})

describe('shouldApplyStatus', () => {
  it('never lets a late delivered erase a bounce or a complaint', () => {
    expect(shouldApplyStatus('bounced', 'delivered')).toBe(false)
    expect(shouldApplyStatus('complained', 'delivered')).toBe(false)
    expect(shouldApplyStatus('complained', 'bounced')).toBe(false)
  })

  it('lets a real failure outrank an earlier success', () => {
    expect(shouldApplyStatus('delivered', 'bounced')).toBe(true)
    expect(shouldApplyStatus('bounced', 'complained')).toBe(true)
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true)
  })

  it('ignores an unknown incoming status but can still write onto an unknown stored one', () => {
    expect(shouldApplyStatus('sent', 'opened')).toBe(false)
    expect(shouldApplyStatus('something-else', 'bounced')).toBe(true)
  })
})

/** Chainable stand-in for the two query shapes the route builds. */
function supabase({ row, updated = [{ id: 'log_1' }] }: {
  row?: Record<string, unknown> | null
  updated?: Array<{ id: string }>
}) {
  const update = vi.fn()
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: row ? [row] : [], error: null })),
  }
  const updateBuilder = {
    eq: vi.fn(() => updateBuilder),
    select: vi.fn(() => Promise.resolve({ data: updated, error: null })),
  }
  mocks.from.mockReturnValue({
    select: builder.select,
    eq: builder.eq,
    order: builder.order,
    limit: builder.limit,
    update: update.mockReturnValue(updateBuilder),
  })
  return { update, updateBuilder }
}

function request(body: string, signed = true) {
  const id = 'msg_1'
  const ts = Math.floor(Date.now() / 1000)
  return new Request('http://app.test/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: signed
      ? { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': sign(body, id, ts) }
      : {},
  })
}

describe('resend webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = SECRET
  })

  it('503s when the signing secret is not configured', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await webhook(request(JSON.stringify({ type: 'email.bounced' })))
    expect(res.status).toBe(503)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('401s on an unsigned request before touching the database', async () => {
    const res = await webhook(request(JSON.stringify({ type: 'email.bounced' }), false))
    expect(res.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('records a bounce with its reason', async () => {
    const { update } = supabase({ row: { id: 'log_1', status: 'sent', error: null } })
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'e1', bounce: { type: 'Permanent', subType: 'General', message: 'mailbox not found' } },
    })
    const res = await webhook(request(body))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'bounced' })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'bounced',
        error: expect.stringContaining('mailbox not found'),
      }),
    )
  })

  it('does not downgrade a bounced row when a delivered event arrives late', async () => {
    const { update } = supabase({ row: { id: 'log_1', status: 'bounced', error: 'gone' } })
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } })
    const res = await webhook(request(body))

    expect(await res.json()).toEqual({ ok: true, unchanged: 'bounced' })
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps the send-time error rather than overwriting it', async () => {
    const { update } = supabase({ row: { id: 'log_1', status: 'sent', error: 'original failure' } })
    const body = JSON.stringify({ type: 'email.complained', data: { email_id: 'e1' } })
    await webhook(request(body))

    expect(update).toHaveBeenCalledWith({ status: 'complained' })
  })

  it('acknowledges events that carry no email_log row', async () => {
    for (const type of ['contact.created', 'domain.updated', 'suppression.added', 'email.opened']) {
      const res = await webhook(request(JSON.stringify({ type, data: {} })))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, ignored: type })
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('acknowledges an email id it has never seen so Resend stops retrying', async () => {
    supabase({ row: null })
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'unknown' } })
    const res = await webhook(request(body))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: 'unknown email id' })
  })

  it('400s when a status event omits the email id', async () => {
    const res = await webhook(request(JSON.stringify({ type: 'email.bounced', data: {} })))
    expect(res.status).toBe(400)
  })
})
