import { describe, expect, it } from 'vitest'
import { buildWorkGraph } from '@/lib/work/buildWorkGraph'
import type { EmailTriageRow } from '@/lib/queries/emailTriage'
import type { TodayData } from '@/lib/queries/today'

const NOW = new Date('2026-09-30T14:00:00.000Z')

function today(overrides: Partial<TodayData> = {}): TodayData {
  return {
    atRisk: [], waitingOnYou: [], waitingOnClient: [], snoozed: [], unreadThreads: [],
    intakeReview: [], intakeToSend: [], appointmentsToday: [], overdueTasks: [], tasksDueToday: [],
    activeMatterCount: 0, needsYou: 0, overdueCount: 0, overdueMatterCount: 0, overdueLeadCount: 0,
    billing: { unbilledCount: 0, unbilledCents: 0, overdueInvoices: [], overdueCents: 0 },
    ...overrides,
  }
}

function emailRow(overrides: Partial<EmailTriageRow>): EmailTriageRow {
  return {
    id: 'e1',
    gmail_thread_id: 'g1',
    gmail_message_id: 'm1',
    sender_email: 'client@example.com',
    sender_name: 'Client',
    subject: 'Question',
    snippet: 'Hello',
    received_at: '2026-09-30T12:00:00.000Z',
    classification: 'client',
    classification_reason: null,
    client_intake_id: null,
    matter_id: '11111111-1111-1111-1111-111111111111',
    contact_id: null,
    record_linked_manually: false,
    status: 'needs_reply',
    draft_subject: null,
    draft_body: null,
    draft_error: null,
    gmail_draft_id: null,
    gmail_draft_message_id: null,
    human_draft_at: null,
    snoozed_until: null,
    follow_up_at: null,
    follow_up_note: null,
    claimed_by: null,
    thread_note: null,
    gmail_sorted_at: null,
    gmail_sort_label: null,
    ...overrides,
  }
}

describe('work graph email snooze and follow-up', () => {
  it('excludes actively snoozed triage rows from Today', () => {
    const result = buildWorkGraph({
      today: today(),
      email: [
        emailRow({ id: 'open' }),
        emailRow({
          id: 'snoozed',
          snoozed_until: '2026-10-01T14:00:00.000Z',
        }),
      ],
    }, NOW)
    const emailKeys = result.items.filter(i => i.sourceType === 'email').map(i => i.workKey)
    expect(emailKeys).toContain('email:open:reply')
    expect(emailKeys).not.toContain('email:snoozed:reply')
  })

  it('surfaces overdue follow-ups after a reply', () => {
    const result = buildWorkGraph({
      today: today(),
      email: [
        emailRow({
          id: 'fu',
          status: 'replied',
          follow_up_at: '2026-09-30T13:00:00.000Z',
        }),
      ],
    }, NOW)
    const item = result.items.find(i => i.workKey === 'email:fu:follow_up')
    expect(item?.actionLabel).toBe('Check follow-up')
    expect(item?.batchTag).toBe('communications')
  })

  it('includes the follow-up note in the work-item reason', () => {
    const result = buildWorkGraph({
      today: today(),
      email: [
        emailRow({
          id: 'fu-note',
          status: 'replied',
          follow_up_at: '2026-09-30T13:00:00.000Z',
          follow_up_note: 'Waiting on deed draft',
        }),
      ],
    }, NOW)
    const item = result.items.find(i => i.workKey === 'email:fu-note:follow_up')
    expect(item?.priorityReasons[0]?.label).toContain('Waiting on deed draft')
  })
})
