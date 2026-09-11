/**
 * The headers that make a reply a reply.
 *
 * Gmail threads a draft on its `threadId` field, but that field is Gmail's own
 * and travels nowhere: the client's mail app has only `In-Reply-To` and
 * `References` to work from. Send without them and the reply arrives as a new
 * conversation in the client's inbox even though it looked correctly threaded
 * in Gmail — which is exactly the sort of thing nobody notices from the sending
 * side.
 *
 * RFC 5322 §3.6.4 is the whole specification: `In-Reply-To` is the parent's
 * `Message-ID`, and `References` is the parent's chain with the parent's own
 * id appended.
 */

/** Long threads would otherwise grow an unbounded header; clients cap too. */
const MAX_REFERENCES = 20

/** `<id@host>` tokens, which is all either header may contain. */
function messageIds(raw: string | null | undefined): string[] {
  return (raw ?? '').match(/<[^<>\s]+>/g) ?? []
}

export interface ReplyHeaders {
  inReplyTo?: string
  references?: string[]
}

export function buildReplyHeaders(parent: {
  messageId: string | null | undefined
  references?: string | null
  inReplyTo?: string | null
}): ReplyHeaders {
  const parentId = messageIds(parent.messageId)[0]
  // A message with no usable Message-ID cannot be replied to by reference. Say
  // nothing rather than emit a malformed header: Gmail's threadId still
  // threads it on the firm's side, and a wrong header would break the client's.
  if (!parentId) return {}

  // A parent with no References of its own is the start of the thread; its
  // In-Reply-To is the next best chain, per §3.6.4.
  const inherited = messageIds(parent.references).length
    ? messageIds(parent.references)
    : messageIds(parent.inReplyTo)

  const chain = Array.from(new Set([...inherited, parentId]))

  // Keep the first — it identifies the thread's root, which is what clients
  // group on — and the most recent of the rest.
  const references = chain.length <= MAX_REFERENCES
    ? chain
    : [chain[0], ...chain.slice(chain.length - (MAX_REFERENCES - 1))]

  return { inReplyTo: parentId, references }
}
