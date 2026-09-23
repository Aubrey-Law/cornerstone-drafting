import fs from 'node:fs'
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { smsProvider, voiceProvider } from '@/lib/communications/providers'
import { telnyxConfigStatus, telnyxCredentialIdForUser } from '@/lib/telnyx/config'
import {
  buildTelnyxInboundTexml,
  telnyxInboundRouteConfig,
} from '@/lib/telnyx/inbound'
import {
  mergeTelnyxCallRows,
  telnyxVoiceEventToRow,
} from '@/lib/telnyx/voice'
import {
  unwrapTelnyxWebhook,
  verifyTelnyxWebhookSignature,
} from '@/lib/telnyx/client'
import { GET as getTelnyxInboundTexml } from '@/app/api/voice/telnyx/inbound/route'

afterEach(() => vi.unstubAllEnvs())

function signedTelnyxFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const rawBody = '{"data":{"id":"event-1","event_type":"call.initiated","payload":{}}}'
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    privateKey,
  ).toString('base64')
  return { rawBody, signature, timestamp, publicKey: rawPublicKey.toString('base64') }
}

function stubCompleteTelnyxInboundEnv() {
  vi.stubEnv('VOICE_PROVIDER', 'telnyx')
  vi.stubEnv('TELNYX_API_KEY', 'KEY_TEST')
  vi.stubEnv('TELNYX_PUBLIC_KEY', Buffer.alloc(32, 1).toString('base64'))
  vi.stubEnv('TELNYX_CONNECTION_ID', 'connection-1')
  vi.stubEnv('TELNYX_TELEPHONY_CREDENTIAL_IDS', '{"scott":"credential-1"}')
  vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
  vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
  vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
}

describe('Telnyx communications migration', () => {
  it('accepts an authentic Telnyx Ed25519 webhook', async () => {
    const fixture = signedTelnyxFixture()
    vi.stubEnv('TELNYX_API_KEY', 'KEY_TEST')
    vi.stubEnv('TELNYX_PUBLIC_KEY', fixture.publicKey)
    const request = new Request('https://example.test/webhook', {
      method: 'POST',
      headers: {
        'telnyx-signature-ed25519': fixture.signature,
        'telnyx-timestamp': fixture.timestamp,
      },
      body: fixture.rawBody,
    })
    await expect(unwrapTelnyxWebhook(request, fixture.rawBody)).resolves.toMatchObject({
      data: { id: 'event-1', event_type: 'call.initiated' },
    })
  })

  it('rejects a changed Telnyx webhook payload', () => {
    const fixture = signedTelnyxFixture()
    expect(() => verifyTelnyxWebhookSignature(
      `${fixture.rawBody} `,
      fixture.signature,
      fixture.timestamp,
      fixture.publicKey,
    )).toThrow('Invalid Telnyx webhook signature')
  })

  it('rejects a stale Telnyx webhook timestamp', () => {
    const fixture = signedTelnyxFixture()
    expect(() => verifyTelnyxWebhookSignature(
      fixture.rawBody,
      fixture.signature,
      fixture.timestamp,
      fixture.publicKey,
      Number(fixture.timestamp) + 301,
    )).toThrow('Telnyx webhook timestamp is outside the allowed tolerance')
  })

  it('rejects a Telnyx webhook with missing signature headers', async () => {
    const fixture = signedTelnyxFixture()
    vi.stubEnv('TELNYX_PUBLIC_KEY', fixture.publicKey)
    const request = new Request('https://example.test/webhook', {
      method: 'POST',
      body: fixture.rawBody,
    })
    await expect(unwrapTelnyxWebhook(request, fixture.rawBody))
      .rejects.toThrow('Missing Telnyx webhook signature headers')
  })

  it('selects SMS and voice independently; SMS defaults to off, voice to Twilio', () => {
    // Texting only runs when someone chose Telnyx on purpose.
    expect(smsProvider()).toBe('none')
    expect(voiceProvider()).toBe('twilio')
    vi.stubEnv('SMS_PROVIDER', 'telnyx')
    expect(smsProvider()).toBe('telnyx')
    expect(voiceProvider()).toBe('twilio')
  })

  it('maps each staff user to a distinct telephony credential', () => {
    vi.stubEnv('TELNYX_TELEPHONY_CREDENTIAL_IDS', JSON.stringify({
      'user-1': 'credential-1',
      'user-2': 'credential-2',
    }))
    expect(telnyxCredentialIdForUser('user-1')).toBe('credential-1')
    expect(telnyxCredentialIdForUser('unknown')).toBeNull()
  })

  it('reports inbound voice configuration separately from outbound voice', () => {
    stubCompleteTelnyxInboundEnv()
    expect(telnyxConfigStatus()).toMatchObject({
      inboundVoiceConfigured: true,
      missing: { inboundVoice: [] },
      webhooks: {
        inboundTeXML: expect.stringContaining('/api/voice/telnyx/inbound'),
        texmlStatus: expect.stringContaining('/api/webhooks/telnyx/texml'),
      },
    })
  })

  it('requires the active Telnyx provider and outbound WebRTC readiness for inbound voice', () => {
    stubCompleteTelnyxInboundEnv()
    vi.stubEnv('VOICE_PROVIDER', 'twilio')
    vi.stubEnv('TELNYX_CONNECTION_ID', '')

    expect(telnyxConfigStatus()).toMatchObject({
      inboundVoiceConfigured: false,
      missing: {
        inboundVoice: expect.arrayContaining([
          'VOICE_PROVIDER=telnyx',
          'TELNYX_CONNECTION_ID',
        ]),
      },
    })
  })

  it('reports invalid present inbound routing values as actionable status issues', () => {
    stubCompleteTelnyxInboundEnv()
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'not-a-sip-uri')

    const status = telnyxConfigStatus()
    expect(status.inboundVoiceConfigured).toBe(false)
    expect(status.missing.inboundVoice).toContain(
      'TELNYX_INBOUND_AGENT_SIP_URI (expected sip:gencred...@sip.telnyx.com)',
    )
  })

  it('normalizes Telnyx voice events into existing call history', () => {
    const row = telnyxVoiceEventToRow({
      data: {
        id: 'event-1',
        event_type: 'call.answered',
        occurred_at: '2026-07-24T14:30:00Z',
        payload: {
          call_control_id: 'call-1',
          direction: 'incoming',
          from: '+16175550100',
          to: '+17815550100',
        },
      },
    })
    expect(row).toMatchObject({
      external_call_id: 'call-1',
      provider: 'telnyx',
      direction: 'inbound',
      status: 'in-progress',
      participant_digits: '16175550100',
      answered_at: '2026-07-24T14:30:00Z',
    })
  })

  it('does not regress a terminal Telnyx call when an older event arrives', () => {
    expect(mergeTelnyxCallRows(
      {
        external_call_id: 'call-1',
        status: 'completed',
        ended_at: '2026-07-24T14:35:00Z',
      },
      {
        external_call_id: 'call-1',
        status: 'ringing',
        ended_at: null,
      },
    )).toMatchObject({
      status: 'completed',
      ended_at: '2026-07-24T14:35:00Z',
    })
  })

  it('keeps the existing initiated fallback for an unknown first voice event', () => {
    expect(mergeTelnyxCallRows(null, {
      external_call_id: 'call-unknown',
      status: 'unknown',
    })).toMatchObject({ status: 'initiated' })
  })

  it('adds Telnyx database providers and idempotency storage', () => {
    const sql = fs.readFileSync('supabase/migrations/20260725014615_telnyx_communications.sql', 'utf8')
    expect(sql).toContain("provider in ('twilio', 'telnyx')")
    expect(sql).toContain("provider in ('twilio', 'telnyx', 'retell')")
    expect(sql).toContain('telephony_webhook_events')
    expect(sql).toContain('unique (provider, provider_event_id)')
  })

  it('routes inbound calls to Scott for 25 seconds before the fallback number', () => {
    const xml = buildTelnyxInboundTexml({
      agentSipUri: 'sip:gencredScott@sip.telnyx.com',
      fallbackDestination: '+13392381012',
      ringTimeoutSeconds: 25,
    })

    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response><Dial answerOnBridge="true" sequential="true" timeout="25">' +
      '<Sip>sip:gencredScott@sip.telnyx.com</Sip>' +
      '<Number>+13392381012</Number>' +
      '</Dial></Response>',
    )
    expect(xml.indexOf('<Sip>')).toBeLessThan(xml.indexOf('<Number>'))
  })

  it('escapes configured TeXML destinations', () => {
    const xml = buildTelnyxInboundTexml({
      agentSipUri: 'sip:agent&desk@sip.telnyx.com',
      fallbackDestination: '+13392381012',
      ringTimeoutSeconds: 25,
    })
    expect(xml).toContain('<Sip>sip:agent&amp;desk@sip.telnyx.com</Sip>')
  })

  it('returns a safe hangup document when inbound routing is incomplete', () => {
    expect(buildTelnyxInboundTexml(null)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    )
  })

  it('reads and validates inbound routing configuration', () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
    vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
    expect(telnyxInboundRouteConfig()).toEqual({
      agentSipUri: 'sip:gencredScott@sip.telnyx.com',
      fallbackDestination: '+13392381012',
      ringTimeoutSeconds: 25,
    })
  })

  it('rejects credential-bearing SIP URIs and serves a safe hangup document', async () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott:password@sip.telnyx.com')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')

    expect(telnyxInboundRouteConfig()).toBeNull()
    const response = getTelnyxInboundTexml()
    expect(await response.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    )
  })

  it('rejects SIP targets outside the generated-credential Telnyx host', () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@attacker.example')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')

    expect(telnyxInboundRouteConfig()).toBeNull()
  })

  it('requires a strict decimal ring timeout before clamping', () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
    vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '7seconds')

    expect(telnyxInboundRouteConfig()).toMatchObject({ ringTimeoutSeconds: 25 })
  })

  it('caps the inbound ring timeout at the TeXML maximum of 120 seconds', () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
    vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '121')

    expect(telnyxInboundRouteConfig()).toMatchObject({ ringTimeoutSeconds: 120 })
  })

  it('serves inbound TeXML without caching', () => {
    vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
    vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
    vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
    const response = getTelnyxInboundTexml()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
