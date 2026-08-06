import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPLY_SLA_HOURS,
  formatWaiting,
  mergeCommunicationItems,
  resolveReplyChannel,
  threadBucket,
  threadIsUnread,
  waitingSince,
  type CommunicationItem,
} from '@/lib/comms/thread'
import { parseThreadKey } from '@/lib/queries/inbox'

function item(partial: Partial<CommunicationItem> & Pick<CommunicationItem, 'id' | 'channel' | 'direction' | 'created_at'>): CommunicationItem {
  return { body: 'body', ...partial }
}

describe('mergeCommunicationItems', () => {
  it('interleaves every source chronologically', () => {
    const merged = mergeCommunicationItems(
      [item({ id: 'p1', channel: 'portal', direction: 'inbound', created_at: '2026-08-01T10:00:00Z' })],
      [item({ id: 's1', channel: 'sms', direction: 'outbound', created_at: '2026-08-01T09:00:00Z' })],
      [item({ id: 'e1', channel: 'email', direction: 'outbound', created_at: '2026-08-01T08:00:00Z' })],
    )
    expect(merged.map(m => m.id)).toEqual(['e1', 's1', 'p1'])
  })

  it('orders identical timestamps deterministically by channel then id', () => {
    const at = '2026-08-01T10:00:00Z'
    const a = [
      item({ id: 'z', channel: 'email', direction: 'inbound', created_at: at }),
      item({ id: 'b', channel: 'portal', direction: 'inbound', created_at: at }),
      item({ id: 'a', channel: 'portal', direction: 'inbound', created_at: at }),
      item({ id: 'm', channel: 'sms', direction: 'inbound', created_at: at }),
    ]
    const first = mergeCommunicationItems(a).map(m => m.id)
    const second = mergeCommunicationItems([...a].reverse()).map(m => m.id)
    expect(first).toEqual(['a', 'b', 'm', 'z'])
    expect(second).toEqual(first)
  })
})

describe('resolveReplyChannel', () => {
  it('locks to the newest inbound channel', () => {
    const items = [
      item({ id: '1', channel: 'portal', direction: 'inbound', created_at: '2026-08-01T09:00:00Z' }),
      item({ id: '2', channel: 'sms', direction: 'inbound', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(resolveReplyChannel(items, 'matter')).toBe('sms')
  })


  it('defaults to portal for matters and email for leads with no inbound', () => {
    const items = [
      item({ id: '1', channel: 'email', direction: 'outbound', created_at: '2026-08-01T09:00:00Z' }),
    ]
    expect(resolveReplyChannel(items, 'matter')).toBe('portal')
    expect(resolveReplyChannel(items, 'lead')).toBe('email')
  })

  it('never offers portal on a lead or contact thread', () => {
    // Portal messages are matter-only in the schema, but defend anyway.
    const items = [
      item({ id: '1', channel: 'sms', direction: 'inbound', created_at: '2026-08-01T09:00:00Z' }),
      item({ id: '2', channel: 'portal', direction: 'inbound', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(resolveReplyChannel(items, 'lead')).toBe('sms')
    expect(resolveReplyChannel(items, 'contact')).toBe('sms')
  })

  it('opens a fresh contact thread on email', () => {
    // Nothing has been exchanged yet, so the composer should start where a
    // cold outreach to a referral partner usually does.
    expect(resolveReplyChannel([], 'contact')).toBe('email')
  })

  it('respects portalAvailable=false on matter surfaces without a portal composer', () => {
    const items = [
      item({ id: '1', channel: 'portal', direction: 'inbound', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(resolveReplyChannel(items, 'matter', { portalAvailable: false })).toBe('email')
  })
})

describe('waitingSince', () => {
  it('is the newest inbound message with no later outbound reply', () => {
    const items = [
      item({ id: '1', channel: 'sms', direction: 'inbound', created_at: '2026-08-01T09:00:00Z' }),
      item({ id: '2', channel: 'sms', direction: 'inbound', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(waitingSince(items)).toBe('2026-08-01T10:00:00Z')
  })

  it('clears once any outbound touch answers the thread', () => {
    const items = [
      item({ id: '1', channel: 'sms', direction: 'inbound', created_at: '2026-08-01T09:00:00Z' }),
      item({ id: '2', channel: 'email', direction: 'outbound', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(waitingSince(items)).toBeNull()
  })


})

describe('threadBucket', () => {
  const now = new Date('2026-08-01T18:00:00Z')

  it('marks threads past the reply SLA as overdue', () => {
    const waiting = new Date(now.getTime() - (DEFAULT_REPLY_SLA_HOURS + 1) * 3600_000).toISOString()
    expect(threadBucket({ waiting_since: waiting, snoozed_until: null }, now)).toBe('overdue')
  })

  it('groups same-day arrivals under today', () => {
    expect(threadBucket(
      { waiting_since: '2026-08-01T15:00:00Z', snoozed_until: null },
      now,
    )).toBe('today')
  })

  it('active snooze wins over overdue', () => {
    const waiting = new Date(now.getTime() - 72 * 3600_000).toISOString()
    const snoozed = new Date(now.getTime() + 3600_000).toISOString()
    expect(threadBucket({ waiting_since: waiting, snoozed_until: snoozed }, now)).toBe('snoozed')
  })

  it('an expired snooze returns the thread to the queue', () => {
    const waiting = new Date(now.getTime() - 72 * 3600_000).toISOString()
    const snoozed = new Date(now.getTime() - 3600_000).toISOString()
    expect(threadBucket({ waiting_since: waiting, snoozed_until: snoozed }, now)).toBe('overdue')
  })

  it('answered threads leave the reply queue', () => {
    expect(threadBucket({ waiting_since: null, snoozed_until: null }, now)).toBe('none')
  })

  it('honors a custom SLA threshold', () => {
    const waiting = new Date(now.getTime() - 2 * 3600_000).toISOString()
    expect(threadBucket({ waiting_since: waiting, snoozed_until: null }, now, 1)).toBe('overdue')
  })
})

describe('formatWaiting', () => {
  const now = new Date('2026-08-01T12:00:00Z')
  it('renders minutes, hours and days compactly', () => {
    expect(formatWaiting('2026-08-01T11:25:00Z', now)).toBe('35m')
    expect(formatWaiting('2026-08-01T07:00:00Z', now)).toBe('5h')
    expect(formatWaiting('2026-07-30T11:00:00Z', now)).toBe('2d')
  })
})

describe('threadIsUnread', () => {
  it('is unread on row-level unreads or a manual flag', () => {
    expect(threadIsUnread({ unread_count: 2, marked_unread_at: null })).toBe(true)
    expect(threadIsUnread({ unread_count: 0, marked_unread_at: '2026-08-01T10:00:00Z' })).toBe(true)
    expect(threadIsUnread({ unread_count: 0, marked_unread_at: null })).toBe(false)
  })
})

describe('parseThreadKey', () => {
  it('accepts matter, lead and contact keys with UUIDs only', () => {
    expect(parseThreadKey('matter:0d4c7b9a-1f2e-4a5b-8c6d-9e0f1a2b3c4d')).toEqual({
      recordType: 'matter',
      recordId: '0d4c7b9a-1f2e-4a5b-8c6d-9e0f1a2b3c4d',
    })
    expect(parseThreadKey('lead:0d4c7b9a-1f2e-4a5b-8c6d-9e0f1a2b3c4d')?.recordType).toBe('lead')
    expect(parseThreadKey('contact:0d4c7b9a-1f2e-4a5b-8c6d-9e0f1a2b3c4d')?.recordType).toBe('contact')
  })

  it('still rejects anything that is not a UUID', () => {
    expect(parseThreadKey('matter:1 OR 1=1')).toBeNull()
    expect(parseThreadKey('contact:1 OR 1=1')).toBeNull()
    expect(parseThreadKey('user:0d4c7b9a-1f2e-4a5b-8c6d-9e0f1a2b3c4d')).toBeNull()
  })
})
