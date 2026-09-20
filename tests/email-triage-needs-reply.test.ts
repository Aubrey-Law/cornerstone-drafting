import { describe, expect, it } from 'vitest'

import { evaluateNeedsReply, isOutbound } from '@/lib/emailTriage/needsReply'
import type { GmailMessageSummary, GmailThreadSummary } from '@/lib/email/gmailRead'

/**
 * The rule the whole queue rests on. Its failure modes are both bad in
 * different ways: too eager and the attorney is nagged about mail he has
 * already answered, which is how a page like this gets closed for good; too
 * shy and a client waits.
 */

const ME = 'scott@aubreylegal.com'

let seq = 0
function message(
  from: string,
  opts: { labels?: string[]; at?: number; id?: string } = {},
): GmailMessageSummary {
  seq += 1
  return {
    id: opts.id ?? `m${seq}`,
    threadId: 't1',
    from: { name: null, email: from },
    to: [],
    cc: [],
    subject: 'Your estate plan',
    snippet: '',
    receivedAt: new Date(1_788_000_000_000 + (opts.at ?? seq) * 60_000).toISOString(),
    messageIdHeader: `<${opts.id ?? `m${seq}`}@mail>`,
    references: null,
    inReplyTo: null,
    headers: {},
    bodyText: 'body',
    labelIds: opts.labels ?? ['INBOX'],
  }
}

const thread = (...messages: GmailMessageSummary[]): GmailThreadSummary => ({ id: 't1', messages })

describe('isOutbound', () => {
  it('trusts the SENT label over the sender address', () => {
    // Gmail labels what the account sent. This is the signal that survives
    // aliases, delegated send, and a From the account rewrote.
    expect(isOutbound(message('anything@example.com', { labels: ['SENT'] }), ME)).toBe(true)
  })

  it('recognises the connected address when the label is not there yet', () => {
    expect(isOutbound(message(ME, { labels: [] }), ME)).toBe(true)
    expect(isOutbound(message('SCOTT@AubreyLegal.com', { labels: [] }), ME)).toBe(true)
  })

  it('recognises a send-as alias', () => {
    // Without this every reply sent from the alias reads as inbound and the
    // thread never leaves the queue.
    expect(isOutbound(message('info@aubreylegal.com', { labels: [] }), ME, ['info@aubreylegal.com']))
      .toBe(true)
  })

  it('treats a client message as inbound', () => {
    expect(isOutbound(message('jane@example.com'), ME)).toBe(false)
  })
})

describe('evaluateNeedsReply', () => {
  it('flags a thread whose last message is from the client', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(
        message(ME, { labels: ['SENT'], at: 1 }),
        message('jane@example.com', { at: 2, id: 'inbound' }),
      ),
    })
    expect(verdict).toMatchObject({ needsReply: true, inboundMessageId: 'inbound', messageCount: 2 })
  })

  it('drops a thread the attorney already answered from his phone', () => {
    // The case this feature lives or dies on. A phone reply is a real SENT
    // message in the thread, so the thread resolves itself on the next scan
    // with nothing for anyone to click.
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(
        message('jane@example.com', { at: 1 }),
        message(ME, { labels: ['SENT'], at: 2 }),
      ),
    })
    expect(verdict).toEqual({ needsReply: false, reason: 'already_replied' })
  })

  it('drops a thread answered from an alias', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      aliasAddresses: ['scott@aubrey.law'],
      thread: thread(
        message('jane@example.com', { at: 1 }),
        message('scott@aubrey.law', { labels: [], at: 2 }),
      ),
    })
    expect(verdict).toEqual({ needsReply: false, reason: 'already_replied' })
  })

  it('still reports a waiting thread the attorney has started answering', () => {
    // A half-written reply used to end the verdict here, which dropped the
    // thread from the queue and — for a thread with no row yet — meant no row
    // was ever created. It then aged out of the scan window and was lost.
    // The client is still waiting; the draft is a fact about the row, not a
    // reason to stop tracking it.
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(
        message('jane@example.com', { at: 1, id: 'inbound' }),
        message(ME, { labels: ['DRAFT'], at: 2, id: 'his-draft' }),
      ),
    })
    expect(verdict).toMatchObject({
      needsReply: true,
      inboundMessageId: 'inbound',
      humanDraftInProgress: true,
    })
  })

  it('does not call a thread waiting when the draft sits after a real reply', () => {
    // Drafts are not part of the running order: the last thing actually said
    // is the attorney's reply, so the thread is answered.
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(
        message('jane@example.com', { at: 1 }),
        message(ME, { labels: ['SENT'], at: 2 }),
        message(ME, { labels: ['DRAFT'], at: 3, id: 'his-draft' }),
      ),
    })
    expect(verdict).toEqual({ needsReply: false, reason: 'already_replied' })
  })

  it('does not treat its own pushed draft as the attorney being mid-compose', () => {
    // Otherwise every approved thread bounces straight back into the queue.
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      ownDraftMessageIds: ['ours'],
      thread: thread(
        message('jane@example.com', { at: 1, id: 'inbound' }),
        message(ME, { labels: ['DRAFT'], at: 2, id: 'ours' }),
      ),
    })
    expect(verdict).toMatchObject({
      needsReply: true,
      inboundMessageId: 'inbound',
      humanDraftInProgress: false,
    })
  })

  it('counts only the conversation, not the draft sitting beside it', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      ownDraftMessageIds: ['ours'],
      thread: thread(
        message(ME, { labels: ['SENT'], at: 1 }),
        message('jane@example.com', { at: 2, id: 'inbound' }),
        message(ME, { labels: ['DRAFT'], at: 3, id: 'ours' }),
      ),
    })
    expect(verdict).toMatchObject({ needsReply: true, inboundMessageId: 'inbound', messageCount: 2 })
  })

  it('moves to the newer message when the client writes again', () => {
    // The stale-draft trigger: the reply now has to answer a different message.
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(
        message('jane@example.com', { at: 1, id: 'first' }),
        message('jane@example.com', { at: 2, id: 'second' }),
      ),
    })
    expect(verdict).toMatchObject({ needsReply: true, inboundMessageId: 'second' })
  })

  it('ignores a thread the attorney threw away', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(message('jane@example.com', { labels: ['TRASH'] })),
    })
    expect(verdict).toEqual({ needsReply: false, reason: 'trashed' })
  })

  it('ignores a thread Gmail marked spam', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(message('scam@example.com', { labels: ['SPAM'] })),
    })
    expect(verdict).toEqual({ needsReply: false, reason: 'trashed' })
  })

  it('says nothing is owed on a thread the firm only ever sent into', () => {
    const verdict = evaluateNeedsReply({
      connectedAddress: ME,
      thread: thread(message(ME, { labels: ['SENT'], at: 1 })),
    })
    expect(verdict.needsReply).toBe(false)
  })

  it('handles an empty thread without throwing', () => {
    expect(evaluateNeedsReply({ connectedAddress: ME, thread: thread() }))
      .toEqual({ needsReply: false, reason: 'no_messages' })
  })
})
