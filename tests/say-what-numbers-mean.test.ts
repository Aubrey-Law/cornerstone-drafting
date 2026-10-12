import { describe, expect, it } from 'vitest'
import { describeAutomationSchedule } from '@/lib/automations/scheduleLabel'
import { ledgerChargeLabel, readyForLabel } from '@/lib/billing/ledgerCopy'
import { leadListStageName } from '@/components/leads/LeadProgress'
import type { LeadListRow } from '@/lib/leads/viewTypes'

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

describe('ledger labels', () => {
  it('drops TBD once a flat fee has an amount', () => {
    expect(ledgerChargeLabel('Flat fee - TBD', 450_000)).toBe('Flat fee')
    expect(ledgerChargeLabel('Flat fee — TBD', 450_000)).toBe('Flat fee')
    expect(ledgerChargeLabel('Flat fee - TBD', 0)).toBe('Flat fee - TBD')
    expect(ledgerChargeLabel('Flat fee — Joint trust package', 450_000)).toBe('Flat fee — Joint trust package')
  })

  it('says how long a charge has been ready', () => {
    expect(readyForLabel(0)).toBe('Ready today.')
    expect(readyForLabel(1)).toBe('Ready for 1 day.')
    expect(readyForLabel(2)).toBe('Ready for 2 days.')
  })
})

describe('automation schedules', () => {
  it('turns the firm crons into a sentence', () => {
    expect(describeAutomationSchedule('0 12 * * 1-5', 'UTC')).toBe('Weekdays at 12:00 PM UTC')
    expect(describeAutomationSchedule('45 11 * * 1-5', 'UTC')).toBe('Weekdays at 11:45 AM UTC')
    expect(describeAutomationSchedule('*/5 * * * *', 'UTC')).toBe('Every 5 minutes')
    expect(describeAutomationSchedule('* * * * *', 'UTC')).toBe('Every minute')
    expect(describeAutomationSchedule('0 * * * *', 'UTC')).toBe('Every hour')
    expect(describeAutomationSchedule('0 * * * 0', 'UTC')).toBe('Every hour on Sunday')
    expect(describeAutomationSchedule('30 11 * * 1-5,15 12 * * 1-5', 'UTC'))
      .toBe('Weekdays at 11:30 AM and Weekdays at 12:15 PM UTC')
  })
})

describe('lead list stage', () => {
  it('names the current stage instead of a dot row', () => {
    expect(leadListStageName(lead())).toBe('Intake')
    expect(leadListStageName(lead({ intake_completed_at: '2026-08-01T00:00:00Z' }))).toBe('Engagement')
    expect(leadListStageName(lead({
      intake_completed_at: '2026-08-01T00:00:00Z',
      engagement_status: 'signed',
    }))).toBe('Hired')
    expect(leadListStageName(lead({ lead_status: 'lost' }))).toBe('Lost')
    expect(leadListStageName(lead({ lead_status: 'declined' }))).toBe('Declined')
  })
})
