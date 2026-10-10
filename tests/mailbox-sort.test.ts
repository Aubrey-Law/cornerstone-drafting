import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CORNERSTONE_LABEL,
  decideMailboxSort,
  triageLabelName,
} from '@/lib/emailTriage/labels'
import { applyMailboxSort, sortMailboxThread } from '@/lib/email/gmailLabels'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('triageLabelName', () => {
  it('uses nested Cornerstone labels, including contacts', () => {
    expect(triageLabelName('client')).toBe(CORNERSTONE_LABEL.client)
    expect(triageLabelName('lead')).toBe(CORNERSTONE_LABEL.lead)
    expect(triageLabelName('possible_lead')).toBe(CORNERSTONE_LABEL.lead)
    expect(triageLabelName('contact')).toBe(CORNERSTONE_LABEL.contact)
  })
})

describe('decideMailboxSort', () => {
  it('keeps needs-reply client mail in the Inbox with a relationship label', () => {
    const decision = decideMailboxSort({
      kind: 'needs_reply',
      classification: 'client',
      archiveEnabled: true,
    })
    expect(decision.addLabels).toContain(CORNERSTONE_LABEL.client)
    expect(decision.archive).toBe(false)
    expect(decision.restoreInbox).toBe(false)
  })

  it('archives hard noise when the setting allows', () => {
    const decision = decideMailboxSort({
      kind: 'noise',
      classification: 'automated',
      archiveEnabled: true,
      automatedHard: true,
    })
    expect(decision.addLabels).toEqual([CORNERSTONE_LABEL.noise])
    expect(decision.archive).toBe(true)
  })

  it('labels soft noise without archiving', () => {
    const decision = decideMailboxSort({
      kind: 'noise',
      classification: 'automated',
      archiveEnabled: true,
      automatedHard: false,
    })
    expect(decision.addLabels).toEqual([CORNERSTONE_LABEL.noise])
    expect(decision.archive).toBe(false)
  })

  it('labels without archiving when the firm setting is off', () => {
    const decision = decideMailboxSort({
      kind: 'handled',
      classification: 'lead',
      archiveEnabled: false,
    })
    expect(decision.addLabels).toEqual([CORNERSTONE_LABEL.handled, CORNERSTONE_LABEL.lead])
    expect(decision.archive).toBe(false)
  })

  it('restores Inbox for an overdue follow-up', () => {
    const decision = decideMailboxSort({
      kind: 'follow_up_due',
      classification: 'client',
      archiveEnabled: true,
    })
    expect(decision.addLabels).toContain(CORNERSTONE_LABEL.followUp)
    expect(decision.restoreInbox).toBe(true)
    expect(decision.archive).toBe(false)
  })

  it('snoozes with archive and the Snoozed label', () => {
    const decision = decideMailboxSort({
      kind: 'snoozed',
      classification: 'client',
      archiveEnabled: true,
    })
    expect(decision.addLabels).toContain(CORNERSTONE_LABEL.snoozed)
    expect(decision.archive).toBe(true)
  })
})

describe('applyMailboxSort', () => {
  it('adds Cornerstone labels and removes INBOX when archiving', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'INBOX', name: 'INBOX' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'Label_N', name: CORNERSTONE_LABEL.noise }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const label = await sortMailboxThread({
      token: 't',
      threadId: 'thread-1',
      kind: 'noise',
      classification: 'automated',
      archiveEnabled: true,
      automatedHard: true,
    })

    expect(label).toBe(CORNERSTONE_LABEL.noise)
    const modify = fetchMock.mock.calls.at(-1)
    expect(modify?.[0]).toContain('/threads/thread-1/modify')
    expect(JSON.parse(modify?.[1].body)).toEqual({
      addLabelIds: ['Label_N'],
      removeLabelIds: ['INBOX'],
    })
  })

  it('strips legacy flat Client/Lead when applying Cornerstone labels', async () => {
    const decision = decideMailboxSort({
      kind: 'needs_reply',
      classification: 'client',
      archiveEnabled: true,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        labels: [
          { id: 'Label_Old', name: 'Client' },
          { id: 'INBOX', name: 'INBOX' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'Label_C', name: CORNERSTONE_LABEL.client }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await applyMailboxSort({ token: 't', threadId: 'x', decision })

    const body = JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)
    expect(body.addLabelIds).toContain('Label_C')
    expect(body.removeLabelIds).toContain('Label_Old')
  })
})
