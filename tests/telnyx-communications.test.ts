import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { smsProvider, voiceProvider } from '@/lib/communications/providers'
import { telnyxCredentialIdForUser } from '@/lib/telnyx/config'
import { telnyxVoiceEventToRow } from '@/lib/telnyx/voice'

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
})
