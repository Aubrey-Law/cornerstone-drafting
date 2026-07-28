import { describe, expect, it } from 'vitest'
import { buildLeadBriefing, buildMatterBriefing, openItemsSentence } from '@/lib/phoneContext'
import type { PipelineMatter } from '@/types/database'

const NOW = '2026-07-28T12:00:00Z'

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm1',
    matter_name: 'Whitfield Family Trust',
    client_name: 'Margaret Whitfield',
    stage: 'drafting',
    status: 'active',
    intake_status: 'completed',
    intake_sent_at: '2026-07-01T12:00:00Z',
    ...overrides,
  } as PipelineMatter
}

describe('call briefings', () => {
  it('summarises a lead that has not been quoted or engaged', () => {
    const briefing = buildLeadBriefing({
      leadId: 'l1',
      name: 'Margaret Whitfield',
      leadStatus: 'lead',
      intakeSentAt: '2026-07-24T12:00:00Z',
      intakeCompletedAt: '2026-07-26T12:00:00Z',
      nextAppointmentAt: null,
      feeQuoted: null,
      hasActiveAgreement: false,
      agreementSigned: false,
      lastTouchAt: '2026-07-24T12:00:00Z',
      now: NOW,
    })

    expect(briefing.recordType).toBe('lead')
    expect(briefing.headline).toBe('Quote the engagement fee')
    expect(briefing.lines[0]).toBe('engagement not sent · intake complete')
    expect(briefing.lines[1]).toContain('no fee quoted')
    expect(briefing.lines[1]).toContain('last touch 4d ago')
    // Never more than two lines — the incoming screen has to stay readable.
    expect(briefing.lines.length).toBeLessThanOrEqual(2)
    expect(briefing.openItems).toContain('No fee quoted')
    expect(briefing.followUps).toEqual([
      { id: 'lead_note', label: 'Add this summary to the lead timeline', kind: 'lead_note' },
    ])
  })

  it('counts unread messages and unreviewed uploads as open items on a matter', () => {
    const briefing = buildMatterBriefing({
      matter: matter(),
      matterNumber: '2026-EP-0142',
      engagement: { signed: true, sentAt: '2026-07-02T12:00:00Z', status: 'signed' },
      unreadMessages: 2,
      unreviewedUploads: 1,
      now: NOW,
    })

    expect(briefing.recordType).toBe('matter')
    expect(briefing.matterNumber).toBe('2026-EP-0142')
    expect(briefing.openItems).toContain('2 unread portal messages')
    expect(briefing.openItems).toContain('1 upload not yet reviewed')
    expect(briefing.followUps[0].kind).toBe('matter_note')
  })

  it('leaves nothing to say when a matter is clean', () => {
    const briefing = buildMatterBriefing({
      matter: matter(),
      unreadMessages: 0,
      unreviewedUploads: 0,
      now: NOW,
    })
    // The next action is always present, so the sentence is never empty here.
    expect(openItemsSentence(briefing)).toBe(`${briefing.openItems[0]}.`)
    expect(openItemsSentence({ ...briefing, openItems: [] })).toBeNull()
  })

  it('joins several open items into one sentence', () => {
    const sentence = openItemsSentence({
      recordType: 'matter',
      recordId: 'm1',
      name: 'X',
      matterNumber: null,
      headline: '',
      lines: [],
      openItems: ['Send the engagement', '2 unread messages', '1 upload to review'],
      assistPrompts: [],
      followUps: [],
    })
    expect(sentence).toBe('Send the engagement, 2 unread messages and 1 upload to review.')
  })
})
