import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTwilioVoiceConfigStatus, isTwilioVoiceConfigured } from '@/lib/twilio/config'

describe('getTwilioVoiceConfigStatus', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports all voice-core vars missing when unset', () => {
    const status = getTwilioVoiceConfigStatus()

    expect(status.voiceCoreConfigured).toBe(false)
    expect(isTwilioVoiceConfigured()).toBe(false)
    expect(status.missing.voiceCore).toEqual([
      'TWILIO_ACCOUNT_SID',
      'TWILIO_API_KEY_SID',
      'TWILIO_API_KEY_SECRET',
      'TWILIO_TWIML_APP_SID',
    ])
  })

  it('marks voice core configured when FAB prerequisites are set', () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY_SID', 'SK123')
    vi.stubEnv('TWILIO_API_KEY_SECRET', 'secret')
    vi.stubEnv('TWILIO_TWIML_APP_SID', 'AP123')

    const status = getTwilioVoiceConfigStatus()

    expect(status.voiceCoreConfigured).toBe(true)
    expect(isTwilioVoiceConfigured()).toBe(true)
    expect(status.missing.voiceCore).toEqual([])
    expect(status.missing.outbound).toEqual(['TWILIO_CALLER_ID'])
    expect(status.missing.webhooks).toContain('TWILIO_AUTH_TOKEN')
    expect(status.missing.webhooks).toContain('NEXT_PUBLIC_APP_URL (or NEXT_PUBLIC_SITE_URL)')
    expect(status.missing.inbound).toEqual(['TWILIO_INBOUND_CLIENT_IDENTITIES'])
  })

  it('reports full softphone readiness when required groups are set', () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY_SID', 'SK123')
    vi.stubEnv('TWILIO_API_KEY_SECRET', 'secret')
    vi.stubEnv('TWILIO_TWIML_APP_SID', 'AP123')
    vi.stubEnv('TWILIO_CALLER_ID', '+17814743450')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'auth')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com')
    vi.stubEnv('TWILIO_INBOUND_CLIENT_IDENTITIES', 'user-uuid-1')

    const status = getTwilioVoiceConfigStatus()

    expect(status.outboundConfigured).toBe(true)
    expect(status.webhooksConfigured).toBe(true)
    expect(status.inboundConfigured).toBe(true)
    expect(status.missing).toEqual({
      voiceCore: [],
      outbound: [],
      webhooks: [],
      inbound: [],
    })
  })
})
