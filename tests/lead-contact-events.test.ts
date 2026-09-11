import { describe, expect, it } from 'vitest'
import { clientContactTimestamps } from '@/lib/leads/contactEvents'

describe('client contact timestamps', () => {
  it('does not treat internal records or unanswered calls as client contact', () => {
    expect(clientContactTimestamps([
      { event_type: 'note_added', created_at: '2026-07-25T09:00:00Z' },
      { event_type: 'intake_completed', created_at: '2026-07-25T09:00:00Z' },
      { event_type: 'lead_updated', created_at: '2026-07-25T09:00:00Z' },
      { event_type: 'call_voicemail', created_at: '2026-07-25T09:00:00Z' },
      { event_type: 'call_no_answer', created_at: '2026-07-25T09:00:00Z' },
      { event_type: 'call_wrong_number', created_at: '2026-07-25T09:00:00Z' },
    ])).toEqual({ lastClientContactAt: null, lastClientResponseAt: null })
  })

  it('counts a connected call as contact while preserving the last written response', () => {
    expect(clientContactTimestamps([
      { event_type: 'sms_received', created_at: '2026-07-23T09:00:00Z' },
      { event_type: 'email_sent', created_at: '2026-07-24T09:00:00Z' },
      { event_type: 'call_connected', created_at: '2026-07-25T09:00:00Z' },
    ])).toEqual({ lastClientContactAt: '2026-07-25T09:00:00Z', lastClientResponseAt: '2026-07-23T09:00:00Z' })
  })
})

it('excludes historical failed SMS and suppressed or redirected email activity', () => {
  expect(clientContactTimestamps([
    { event_type: 'sms_sent', title: 'Text failed to Jane', created_at: '2026-07-25T09:00:00Z' },
    { event_type: 'email_sent', detail: 'To jane@example.com · suppressed', created_at: '2026-07-25T09:00:00Z' },
    { event_type: 'email_sent', detail: 'To jane@example.com · logged', created_at: '2026-07-25T09:00:00Z' },
    { event_type: 'email_sent', detail: 'To jane@example.com · redirected · 1 attachment', created_at: '2026-07-25T09:00:00Z' },
  ])).toEqual({ lastClientContactAt: null, lastClientResponseAt: null })
})
