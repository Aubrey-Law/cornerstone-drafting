import { describe, expect, it } from 'vitest'
import { agreementSentInApp, effectiveEngagementStatus } from '@/lib/leads/engagementStatus'

describe('effectiveEngagementStatus', () => {
  const lead = { engagement_status: null, engagement_sent_at: null, engagement_signed_at: null }

  it('shows a send recorded outside the app over an in-app draft', () => {
    // The case this exists for: drafted in the workspace, emailed by hand.
    expect(effectiveEngagementStatus('draft', { ...lead, engagement_status: 'sent', engagement_sent_at: '2026-10-05T12:00:00Z' })).toBe('sent')
    expect(effectiveEngagementStatus('ready', { ...lead, engagement_sent_at: '2026-10-05T12:00:00Z' })).toBe('sent')
  })

  it('shows a signature recorded by hand over an in-app draft', () => {
    expect(effectiveEngagementStatus('draft', { ...lead, engagement_signed_at: '2026-10-06' })).toBe('signed')
  })

  it('trusts the agreement once the app itself has sent it', () => {
    expect(effectiveEngagementStatus('viewed', { ...lead, engagement_sent_at: '2026-10-05T12:00:00Z' })).toBe('viewed')
    expect(effectiveEngagementStatus('completed', lead)).toBe('completed')
  })

  it('falls back to the draft, then to the lead\'s own status', () => {
    expect(effectiveEngagementStatus('draft', lead)).toBe('draft')
    expect(effectiveEngagementStatus(undefined, { ...lead, engagement_status: 'draft' })).toBe('draft')
    expect(effectiveEngagementStatus(null, lead)).toBeNull()
  })

  it('knows which agreement statuses mean the app sent it', () => {
    expect(agreementSentInApp('sent')).toBe(true)
    expect(agreementSentInApp('partially_signed')).toBe(true)
    expect(agreementSentInApp('draft')).toBe(false)
    expect(agreementSentInApp(undefined)).toBe(false)
  })
})
