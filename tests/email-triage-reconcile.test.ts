import { describe, expect, it } from 'vitest'

import {
  TRIAGE_LISTING_CEILING,
  decideThreadAction,
  describeError,
  type ExistingTriageRow,
} from '@/lib/emailTriage/scan'

/**
 * What a rescan does to a thread it has seen before.
 *
 * These rules fail quietly rather than loudly, which is why they are pulled out
 * of the scan and tested on their own: get them wrong and the feature still
 * runs, still reports healthy counts, and either nags about mail the attorney
 * has dealt with or answers a message that is no longer the last word.
 */

const waiting = (id = 'inbound-1', humanDraftInProgress = false) => ({
  needsReply: true as const,
  inboundMessageId: id,
  receivedAt: '2026-09-11T12:00:00.000Z',
  messageCount: 2,
  humanDraftInProgress,
})

const settled = (reason: string) => ({ needsReply: false as const, reason })

function row(over: Partial<ExistingTriageRow> = {}): ExistingTriageRow {
  return {
    id: 'row-1',
    gmail_thread_id: 't1',
    gmail_message_id: 'inbound-1',
    gmail_draft_message_id: null,
    status: 'needs_reply',
    ...over,
  }
}

describe('decideThreadAction', () => {
  it('queues a thread the firm has never seen', () => {
    expect(decideThreadAction(waiting(), undefined)).toEqual({ kind: 'queue', reset: true })
  })

  it('leaves a queued thread’s draft alone when nothing has changed', () => {
    // A rescan every weekday morning must not throw away yesterday's draft.
    expect(decideThreadAction(waiting('inbound-1'), row({ status: 'drafted' })))
      .toEqual({ kind: 'queue', reset: false })
  })

  it('clears the draft when the client has written again', () => {
    // The draft answered a message that is no longer the last thing said.
    expect(decideThreadAction(waiting('inbound-2'), row({ status: 'drafted' })))
      .toEqual({ kind: 'queue', reset: true })
  })

  it('closes a queued thread the attorney answered elsewhere', () => {
    expect(decideThreadAction(settled('already_replied'), row({ status: 'drafted' })))
      .toEqual({ kind: 'resolve' })
  })

  it('does not resurrect a dismissed thread', () => {
    // The bug this function exists to prevent. A dismissed thread still ends
    // with an inbound message — that is what dismissing it meant — so without
    // this the next scan queues it straight back and Dismiss does nothing.
    expect(decideThreadAction(waiting('inbound-1'), row({ status: 'dismissed' })))
      .toEqual({ kind: 'skip' })
  })

  it('does not resurrect a thread already marked replied', () => {
    expect(decideThreadAction(waiting('inbound-1'), row({ status: 'replied' })))
      .toEqual({ kind: 'skip' })
  })

  it('reopens a dismissed thread when the sender writes something new', () => {
    // Dismissal is of a message, not of a correspondent forever — silencing
    // someone permanently is what the ignore rules are for.
    expect(decideThreadAction(waiting('inbound-2'), row({ status: 'dismissed' })))
      .toEqual({ kind: 'queue', reset: true })
  })

  it('reopens a replied thread when the client comes back', () => {
    expect(decideThreadAction(waiting('inbound-2'), row({ status: 'replied' })))
      .toEqual({ kind: 'queue', reset: true })
  })

  it('reopens an approved thread only once the client writes again', () => {
    // Approved means a draft is sitting in Gmail waiting to be sent. Re-queuing
    // it would clear the draft the attorney is about to send.
    const approved = row({ status: 'approved', gmail_draft_message_id: 'draft-1' })
    expect(decideThreadAction(waiting('inbound-1'), approved)).toEqual({ kind: 'skip' })
    expect(decideThreadAction(waiting('inbound-2'), approved))
      .toEqual({ kind: 'queue', reset: true })
  })

  it('leaves a settled thread alone rather than marking it replied twice', () => {
    expect(decideThreadAction(settled('already_replied'), row({ status: 'replied' })))
      .toEqual({ kind: 'skip' })
    expect(decideThreadAction(settled('already_replied'), row({ status: 'dismissed' })))
      .toEqual({ kind: 'skip' })
  })

  it('ignores a thread that was never queued and needs nothing', () => {
    for (const reason of ['no_inbound', 'trashed', 'no_messages']) {
      expect(decideThreadAction(settled(reason), undefined)).toEqual({ kind: 'skip' })
    }
  })

  it('does not close a queued thread for anything short of an actual reply', () => {
    for (const reason of ['trashed', 'no_inbound']) {
      expect(decideThreadAction(settled(reason), row())).toEqual({ kind: 'skip' })
    }
  })

  it('queues a thread the attorney has started answering by hand', () => {
    // The half-written reply is why this row matters, not a reason to drop it:
    // the client is waiting on the send, not on the typing. Skipping it here
    // meant a thread with no row never got one, and once it left the listing
    // window nothing looked at it again.
    expect(decideThreadAction(waiting('inbound-1', true), undefined))
      .toEqual({ kind: 'queue', reset: true })
    expect(decideThreadAction(waiting('inbound-1', true), row()))
      .toEqual({ kind: 'queue', reset: false })
  })
})

describe('the listing ceiling', () => {
  /**
   * The ceiling is a safety valve. It is not the scan window — the window is
   * the `newer_than:` in the search query — and the moment it becomes smaller
   * than the mail arriving between two runs it silently becomes the window,
   * which is the bug this guards.
   *
   * September 2026: the ceiling was 40. The mailbox took about 27 threads a
   * day, so 40 threads was roughly 36 hours, while the cron's worst gap —
   * Friday 12:15 UTC to Monday 11:30 UTC — is 71 hours. Mail landing in the
   * difference was listed by Gmail, dropped here, and never looked at again,
   * because a thread that never reaches the queue leaves no row to return to.
   * A lead's reply and a client's spouse went unanswered for days.
   *
   * The numbers are deliberately pessimistic against today's mailbox: three
   * times the observed rate, and the worst gap rather than the usual one.
   */
  const WORST_CRON_GAP_HOURS = 71
  const PESSIMISTIC_THREADS_PER_DAY = 27 * 3

  it('spans more than the longest gap between two cron runs', () => {
    const hoursCovered = (TRIAGE_LISTING_CEILING / PESSIMISTIC_THREADS_PER_DAY) * 24
    expect(hoursCovered).toBeGreaterThan(WORST_CRON_GAP_HOURS)
  })
})

describe('describeError', () => {
  it('reads the message off a Supabase error, which is a plain object and not an Error', () => {
    // The 14 September cron run failed during a Supabase gateway outage and
    // recorded its cause as "[object Object]".
    const supabaseNetworkFailure = {
      message: 'TypeError: fetch failed',
      details: 'TypeError: fetch failed\n\nCaused by: Error: connect ECONNRESET',
      hint: '',
      code: '',
    }
    expect(describeError(supabaseNetworkFailure)).toBe('TypeError: fetch failed')
  })

  it('appends the Postgres error code when there is one', () => {
    expect(describeError({ message: 'permission denied for table matters', code: '42501' }))
      .toBe('permission denied for table matters (42501)')
  })

  it('uses an Error’s message', () => {
    expect(describeError(new Error('the message is no longer in Gmail')))
      .toBe('the message is no longer in Gmail')
  })

  it('falls back to the string form of anything else', () => {
    expect(describeError('boom')).toBe('boom')
    expect(describeError(42)).toBe('42')
  })
})
