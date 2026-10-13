import { describe, expect, it } from 'vitest'
import { leadAttentionReason, leadValueLabel, leadWaitingLabel } from '@/lib/leads/cardFacts'
import type { LeadListRow } from '@/lib/leads/viewTypes'

/**
 * Each of these replaced a slot that was structurally empty or uselessly
 * uniform. Measured over the 35 open leads: one had a fee quoted, 22 had no
 * source, and "Needs attention" was true of 16 — a chip that says the same
 * thing about half the board is not a signal.
 */

const NOW = Date.parse('2026-08-24T12:00:00Z')

function lead(overrides: Partial<LeadListRow> = {}): LeadListRow {
  return {
    id: 'lead-1',
    full_name: 'Ada Lovelace',
    first_name: null,
    last_name: null,
    email: 'ada@example.com',
    phone: null,
    practice_area: 'EP',
    status: null,
    lead_status: 'lead',
    matter_id: null,
    intake_sent_at: null,
    intake_completed_at: null,
    engagement_status: null,
    engagement_sent_at: null,
    engagement_signed_at: null,
    engagement_fee_quoted: null,
    created_at: '2026-08-01T12:00:00Z',
    updated_at: null,
    lead_urgency: null,
    taxable_estate: null,
    last_activity_at: null,
    ...overrides,
  }
}

describe('what the value slot shows', () => {
  it('prefers the quoted fee', () => {
    expect(leadValueLabel(lead({ engagement_fee_quoted: 4500, billing_type: 'metlife' })))
      .toBe('$4,500.00')
  })

  it('falls back to the plan, which is recorded long before the fee', () => {
    expect(leadValueLabel(lead({ billing_type: 'metlife' }))).toBe('MetLife')
    expect(leadValueLabel(lead({ billing_type: 'legalease' }))).toBe('LegalEASE')
  })

  it('shows nothing for a flat-fee lead with no quote yet', () => {
    // "Flat fee" with no number is not information about this lead.
    expect(leadValueLabel(lead({ billing_type: 'flat_fee' }))).toBeNull()
    expect(leadValueLabel(lead())).toBeNull()
  })
})

describe('how long this lead has been waiting', () => {
  it('reports a booked meeting instead of silence', () => {
    // The same distinction the aging board draws: a call on the calendar is
    // not a lead going cold.
    expect(leadWaitingLabel(lead({ next_appointment_at: '2026-08-27T12:00:00Z' }), NOW))
      .toBe('Meeting in 3 days')
    expect(leadWaitingLabel(lead({ next_appointment_at: '2026-08-24T15:00:00Z' }), NOW))
      .toBe('Meeting today')
    expect(leadWaitingLabel(lead({ next_appointment_at: '2026-08-25T15:00:00Z' }), NOW))
      .toBe('Meeting tomorrow')
  })

  it('counts the quiet once the meeting is behind them', () => {
    expect(leadWaitingLabel(lead({
      next_appointment_at: '2026-08-10T12:00:00Z',
      last_activity_at: '2026-08-17T12:00:00Z',
    }), NOW)).toBe('Quiet 7 days')
  })

  it('says so when nobody has ever made contact', () => {
    expect(leadWaitingLabel(lead({ created_at: null }), NOW)).toBe('No contact yet')
  })

  it('falls back through activity, then the record, then creation', () => {
    expect(leadWaitingLabel(lead({ last_activity_at: '2026-08-23T12:00:00Z' }), NOW)).toBe('Quiet 1 day')
    expect(leadWaitingLabel(lead({ updated_at: '2026-08-22T12:00:00Z' }), NOW)).toBe('Quiet 2 days')
    expect(leadWaitingLabel(lead(), NOW)).toBe('Quiet 23 days')
  })

  it('says the lead was updated today, and names the channel when the touch has one', () => {
    expect(leadWaitingLabel(lead({ last_activity_at: '2026-08-24T09:00:00Z' }), NOW)).toBe('Updated today')
    expect(leadWaitingLabel(lead({
      last_activity_at: '2026-08-24T09:00:00Z',
      last_activity_type: 'email_sent',
    }), NOW)).toBe('Updated today · email')
    expect(leadWaitingLabel(lead({
      last_activity_at: '2026-08-24T09:00:00Z',
      last_activity_type: 'note',
    }), NOW)).toBe('Updated today')
  })
})

describe('why a lead needs attention', () => {
  it('names urgency ahead of silence', () => {
    expect(leadAttentionReason(lead({ lead_urgency: 'high' }), NOW)).toBe('High urgency')
  })

  it('names the silence in days, so two flagged leads can be ranked', () => {
    expect(leadAttentionReason(lead({ last_activity_at: '2026-08-01T12:00:00Z' }), NOW)).toBe('Quiet 23 days')
  })

  it('stays quiet inside the stale window', () => {
    expect(leadAttentionReason(lead({ last_activity_at: '2026-08-20T12:00:00Z' }), NOW)).toBeNull()
  })

  it('never flags a lead that is no longer in play', () => {
    // A lost lead's silence is not a task.
    expect(leadAttentionReason(lead({ lead_status: 'lost', lead_urgency: 'high' }), NOW)).toBeNull()
  })
})
