import { describe, expect, it } from 'vitest'
import { twilioStatusToRow } from '@/lib/twilio/normalize'

describe('twilioStatusToRow', () => {
  it('maps outbound browser call to participant callee', () => {
    const row = twilioStatusToRow({
      CallSid: 'CA123',
      CallStatus: 'completed',
      Direction: 'outbound-api',
      From: 'client:11111111-2222-3333-4444-555555555555',
      To: '+17815551212',
      CallDuration: '42',
      Timestamp: '2026-06-26T12:00:00Z',
    })
    expect(row).not.toBeNull()
    expect(row!.external_call_id).toBe('CA123')
    expect(row!.provider).toBe('twilio')
    expect(row!.direction).toBe('outbound')
    expect(row!.participant_number).toBe('+17815551212')
    expect(row!.firm_user_id).toBe('11111111-2222-3333-4444-555555555555')
    expect(row!.duration_seconds).toBe(42)
  })

  it('maps inbound PSTN call to external caller', () => {
    const row = twilioStatusToRow({
      CallSid: 'CA456',
      CallStatus: 'no-answer',
      Direction: 'inbound',
      From: '+16175551212',
      To: '+17816753466',
    })
    expect(row).not.toBeNull()
    expect(row!.direction).toBe('inbound')
    expect(row!.participant_number).toBe('+16175551212')
    expect(row!.status).toBe('no-answer')
  })
})
