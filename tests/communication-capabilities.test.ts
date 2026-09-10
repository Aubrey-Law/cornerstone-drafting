import { afterEach, describe, expect, it, vi } from 'vitest'
import { smsProvider, voiceProvider, manualCommunicationsEnabled } from '@/lib/communications/providers'
import { sendProviderSmsMessage } from '@/lib/sms/provider'

const { send } = vi.hoisted(() => ({ send: vi.fn(() => { throw new Error('unexpected delivery') }) }))
vi.mock('@/lib/twilio/sms', () => ({ sendSmsMessage: send }))
vi.mock('@/lib/telnyx/sms', () => ({ sendTelnyxSmsMessage: send }))
afterEach(() => { vi.unstubAllEnvs(); send.mockClear() })

describe('communication capabilities', () => {
  it('recognizes explicit disabled providers', () => {
    vi.stubEnv('SMS_PROVIDER', 'none')
    vi.stubEnv('VOICE_PROVIDER', 'none')
    expect(smsProvider()).toBe('none')
    expect(voiceProvider()).toBe('none')
  })
  it('rejects typos instead of selecting Twilio', () => {
    vi.stubEnv('SMS_PROVIDER', 'twilo')
    expect(() => smsProvider()).toThrow(/SMS_PROVIDER/)
  })
  it('preserves the configured automated transport when manual communication is disabled', () => {
    vi.stubEnv('SMS_PROVIDER', 'telnyx')
    vi.stubEnv('MANUAL_COMMUNICATIONS_ENABLED', 'false')
    expect(manualCommunicationsEnabled()).toBe(false)
    expect(smsProvider()).toBe('telnyx')
  })
  it('fails a disabled send before calling a delivery provider', async () => {
    vi.stubEnv('SMS_PROVIDER', 'none')
    expect(await sendProviderSmsMessage({ to: '+15555550100', body: 'Synthetic test' })).toEqual({ ok: false, error: 'SMS delivery is disabled.' })
    expect(send).not.toHaveBeenCalled()
  })
  it('rejects an invalid manual capability flag', () => {
    vi.stubEnv('MANUAL_COMMUNICATIONS_ENABLED', 'flase')
    expect(() => manualCommunicationsEnabled()).toThrow(/MANUAL_COMMUNICATIONS_ENABLED/)
  })
})
