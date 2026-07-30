import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type StoredRow = Record<string, unknown>

const webhookState = vi.hoisted(() => ({
  claims: new Set<string>(),
  claimRows: [] as StoredRow[],
  calls: new Map<string, StoredRow>(),
  recordInboundSms: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: string) {
      if (table === 'telephony_webhook_events') {
        return {
          insert: async (row: StoredRow) => {
            const key = `${row.provider}:${row.provider_event_id}`
            if (webhookState.claims.has(key)) {
              return { error: { code: '23505', message: 'duplicate' } }
            }
            webhookState.claims.add(key)
            webhookState.claimRows.push(row)
            return { error: null }
          },
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }
      }

      if (table === 'calls') {
        return {
          select: () => ({
            eq: (_column: string, callId: string) => ({
              maybeSingle: async () => ({
                data: webhookState.calls.get(callId) ?? null,
                error: null,
              }),
            }),
          }),
          upsert: async (row: StoredRow) => {
            webhookState.calls.set(String(row.external_call_id), row)
            return { error: null }
          },
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'sms_messages') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/sms/inbound', () => ({
  isSmsOptOutMessage: () => false,
  recordInboundSms: (...args: unknown[]) => webhookState.recordInboundSms(...args),
  smsOptOutConfirmation: () => 'You have been unsubscribed.',
}))

vi.mock('@/lib/telnyx/sms', () => ({
  sendTelnyxSmsMessage: vi.fn(),
}))

import { POST as postMessagingWebhook } from '@/app/api/webhooks/telnyx/messaging/route'
import { POST as postVoiceWebhook } from '@/app/api/webhooks/telnyx/voice/route'

function signedHeaders(rawBody: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    privateKey,
  ).toString('base64')
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  vi.stubEnv('TELNYX_PUBLIC_KEY', rawPublicKey.toString('base64'))
  return {
    'telnyx-signature-ed25519': signature,
    'telnyx-timestamp': timestamp,
  }
}

function signedRequest(
  path: string,
  rawBody: string,
  contentType: 'application/json' | 'application/x-www-form-urlencoded',
) {
  return new Request(`https://app.test${path}`, {
    method: 'POST',
    headers: {
      ...signedHeaders(rawBody),
      'content-type': contentType,
    },
    body: rawBody,
  })
}

beforeEach(() => {
  webhookState.claims.clear()
  webhookState.claimRows.length = 0
  webhookState.calls.clear()
  webhookState.recordInboundSms.mockReset().mockResolvedValue({ ok: true, duplicate: false })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('Telnyx webhook route boundaries', () => {
  it('rejects a messaging event on the voice endpoint before claiming its id', async () => {
    const event = {
      data: {
        id: 'shared-event-1',
        event_type: 'message.received',
        occurred_at: '2026-07-30T12:00:00Z',
        payload: {
          id: 'message-1',
          text: 'Hello',
          from: { phone_number: '+16175550100' },
          to: [{ phone_number: '+17815550100' }],
        },
      },
    }
    const rawBody = JSON.stringify(event)

    const voiceResponse = await postVoiceWebhook(signedRequest(
      '/api/webhooks/telnyx/voice',
      rawBody,
      'application/json',
    ))
    expect(voiceResponse.status).toBe(400)
    expect(webhookState.claims.size).toBe(0)

    const messagingResponse = await postMessagingWebhook(signedRequest(
      '/api/webhooks/telnyx/messaging',
      rawBody,
      'application/json',
    ))
    expect(messagingResponse.status).toBe(200)
    expect(webhookState.claims).toContain('telnyx:shared-event-1')
  })

  it('rejects a voice event on the messaging endpoint before claiming its id', async () => {
    const event = {
      data: {
        id: 'shared-event-2',
        event_type: 'call.initiated',
        occurred_at: '2026-07-30T12:00:00Z',
        payload: {
          call_control_id: 'call-2',
          direction: 'incoming',
          from: '+16175550100',
          to: '+17815550100',
        },
      },
    }
    const rawBody = JSON.stringify(event)

    const messagingResponse = await postMessagingWebhook(signedRequest(
      '/api/webhooks/telnyx/messaging',
      rawBody,
      'application/json',
    ))
    expect(messagingResponse.status).toBe(400)
    expect(webhookState.claims.size).toBe(0)

    const voiceResponse = await postVoiceWebhook(signedRequest(
      '/api/webhooks/telnyx/voice',
      rawBody,
      'application/json',
    ))
    expect(voiceResponse.status).toBe(200)
    expect(webhookState.claims).toContain('telnyx:shared-event-2')
    expect(webhookState.calls.get('call-2')).toMatchObject({ status: 'initiated' })
  })

  it('keeps a completed call terminal when an older JSON event arrives later', async () => {
    webhookState.calls.set('call-3', {
      external_call_id: 'call-3',
      provider: 'telnyx',
      direction: 'inbound',
      status: 'completed',
      participant_number: '+16175550100',
      ended_at: '2026-07-30T12:05:00Z',
    })
    const rawBody = JSON.stringify({
      data: {
        id: 'late-event-3',
        event_type: 'call.initiated',
        occurred_at: '2026-07-30T12:00:00Z',
        payload: {
          call_control_id: 'call-3',
          direction: 'incoming',
          from: '+16175550100',
          to: '+17815550100',
        },
      },
    })

    const response = await postVoiceWebhook(signedRequest(
      '/api/webhooks/telnyx/voice',
      rawBody,
      'application/json',
    ))

    expect(response.status).toBe(200)
    expect(webhookState.calls.get('call-3')).toMatchObject({
      status: 'completed',
      ended_at: '2026-07-30T12:05:00Z',
    })
  })

  it('accepts and normalizes a real signed TeXML form callback', async () => {
    const rawBody = new URLSearchParams({
      AccountSid: 'account-1',
      CallSid: 'v3:call-4',
      CallSidLegacy: 'v3:call-4',
      CallStatus: 'in-progress',
      CallbackSource: 'call-progress-events',
      ConnectionId: 'connection-1',
      From: '+16175550100',
      SequenceNumber: '2',
      Timestamp: '2026-07-30T12:02:00Z',
      To: '+17815550100',
      CallInitiatedAt: '2026-07-30T12:00:00Z',
      AnsweredTime: '2026-07-30T12:02:00Z',
    }).toString()
    const { POST: postTexmlWebhook } = await import('@/app/api/webhooks/telnyx/texml/route')

    const response = await postTexmlWebhook(signedRequest(
      '/api/webhooks/telnyx/texml',
      rawBody,
      'application/x-www-form-urlencoded',
    ))

    expect(response.status).toBe(200)
    expect(webhookState.claimRows[0]).toMatchObject({
      provider_event_id: 'texml:v3:call-4:2',
      event_type: 'texml.call.in-progress',
    })
    expect(webhookState.calls.get('v3:call-4')).toMatchObject({
      provider: 'telnyx',
      direction: 'inbound',
      status: 'in-progress',
      from_number: '+16175550100',
      to_number: '+17815550100',
      answered_at: '2026-07-30T12:02:00.000Z',
    })
  })
})
