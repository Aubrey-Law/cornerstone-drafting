import type { GmailThreadSummary } from '@/lib/email/gmailRead'

/**
 * Whether a thread is waiting on the firm.
 *
 * Pure and structural: it reads message order, labels and sender addresses, and
 * nothing else. No database, no network, no model. The whole queue is built on
 * this answer, so it is the piece most worth being able to test exhaustively.
 */

export interface NeedsReplyInput {
  /** The mailbox's own address, lowercased. From `users.getProfile`. */
  connectedAddress: string
  /**
   * Other addresses the attorney sends as. Without these a reply sent from an
   * alias reads as inbound and the thread never leaves the queue.
   */
  aliasAddresses?: string[]
  /**
   * Gmail message ids of drafts Cornerstone itself created on this thread.
   * Excluded from the mid-compose check below: our own approved draft must not
   * read as the attorney being half-way through writing one.
   */
  ownDraftMessageIds?: string[]
  thread: GmailThreadSummary
}

export type NeedsReplyVerdict =
  | {
      needsReply: true
      /** The inbound message a reply would answer. */
      inboundMessageId: string
      receivedAt: string
      messageCount: number
    }
  | {
      needsReply: false
      reason: 'no_messages' | 'no_inbound' | 'already_replied' | 'draft_in_progress' | 'trashed'
    }

function normalise(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * A message is the firm's own if Gmail labelled it SENT or it came from an
 * address the attorney sends as.
 *
 * The SENT label is the authoritative half and is what makes the common case
 * work: a reply typed on a phone is a real SENT message in this thread, so the
 * thread's last message becomes outbound and it drops out of the queue by
 * itself. Address comparison is the backstop for a message Gmail has not
 * labelled yet.
 */
export function isOutbound(
  message: { from: { email: string }; labelIds: string[] },
  connectedAddress: string,
  aliasAddresses: string[] = [],
): boolean {
  if (message.labelIds.includes('SENT')) return true
  const self = new Set([connectedAddress, ...aliasAddresses].map(normalise))
  return self.has(normalise(message.from.email))
}

export function evaluateNeedsReply(input: NeedsReplyInput): NeedsReplyVerdict {
  const { thread, connectedAddress } = input
  const aliases = input.aliasAddresses ?? []
  const ownDrafts = new Set(input.ownDraftMessageIds ?? [])
  const messages = thread.messages

  if (!messages.length) return { needsReply: false, reason: 'no_messages' }

  // A thread the attorney has already thrown away is not waiting on anyone,
  // whatever its last message says.
  if (messages.some(m => m.labelIds.includes('TRASH') || m.labelIds.includes('SPAM'))) {
    return { needsReply: false, reason: 'trashed' }
  }

  // Someone is mid-compose. Nagging about a reply that is already half written
  // is the fastest way to have this page closed for good. Our own pushed draft
  // does not count, or every approved thread would re-enter the queue.
  if (messages.some(m => m.labelIds.includes('DRAFT') && !ownDrafts.has(m.id))) {
    return { needsReply: false, reason: 'draft_in_progress' }
  }

  // `parseThread` sorts oldest first; drafts are not part of the conversation's
  // running order, so they are excluded before the last message is read.
  const conversation = messages.filter(m => !m.labelIds.includes('DRAFT'))
  if (!conversation.length) return { needsReply: false, reason: 'no_messages' }

  const last = conversation[conversation.length - 1]
  if (isOutbound(last, connectedAddress, aliases)) {
    return { needsReply: false, reason: 'already_replied' }
  }
  if (conversation.every(m => isOutbound(m, connectedAddress, aliases))) {
    return { needsReply: false, reason: 'no_inbound' }
  }

  return {
    needsReply: true,
    inboundMessageId: last.id,
    receivedAt: last.receivedAt,
    messageCount: conversation.length,
  }
}
