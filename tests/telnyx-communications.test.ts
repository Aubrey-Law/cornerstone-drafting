import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { smsProvider, voiceProvider } from '@/lib/communications/providers'
import { telnyxCredentialIdForUser } from '@/lib/telnyx/config'
import {
  buildTelnyxInboundTexml,
  telnyxInboundRouteConfig,
} from '@/lib/telnyx/inbound'
import { telnyxVoiceEventToRow } from '@/lib/telnyx/voice'
import { GET as getTelnyxInboundTexml } from '@/app/api/voice/telnyx/inbound/route'

afterEach(() => vi.unstubAllEnvs())

describe('Telnyx communications migration', () => {
  it('selects SMS and voice independently and defaults safely to Twilio', () => {
    expect(smsProvider()).toBe('twilio')
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
