import type { CommunicationItem } from './thread'

/**
 * How a filed inbound email reads on a record's timeline. Pure, so the shape
 * the history route serves is tested without a database.
 */

export interface InboundEmailRow {
  id: string
  gmail_thread_id: string
  sender_email: string
  sender_name: string | null
  subject: string | null
  snippet: string | null
  received_at: string
}

/** Triage states in which a row still offers a reply from the triage page. */
export const OPEN_TRIAGE_STATUSES = ['needs_reply', 'drafting', 'drafted', 'failed', 'approved'] as const

/** Gmail's own permalink for a thread, for the mailbox owner. */
export function gmailThreadHref(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`
}

export function inboundEmailItem(
  row: InboundEmailRow,
  openTriageIdByThread: Map<string, string>,
): CommunicationItem {
  const triageId = openTriageIdByThread.get(row.gmail_thread_id)
  const links = [
    ...(triageId
      ? [{ label: 'Reply in Mail Desk', href: `/admin/email-triage?thread=${encodeURIComponent(triageId)}` }]
      : []),
    { label: 'Open in Gmail', href: gmailThreadHref(row.gmail_thread_id) },
  ]
  const name = row.sender_name?.trim()
  return {
    id: row.id,
    channel: 'email',
    direction: 'inbound',
    body: row.snippet?.trim() || '(No preview available)',
    meta: row.subject?.trim() || '(No subject)',
    sender: name ? `${name} <${row.sender_email}>` : row.sender_email,
    created_at: row.received_at,
    body_href: `/api/admin/comms/email-inbound/${row.id}`,
    links,
  }
}

export interface LiveEmailMessage {
  id: string
  from: { name: string | null; email: string }
  subject: string
  receivedAt: string
  bodyText: string
  outbound: boolean
  filed: boolean
}

/**
 * The live thread as one block of text for the timeline: the filed message
 * first and in full, the rest of the exchange beneath it in order.
 */
export function formatLiveThread(messages: LiveEmailMessage[]): string {
  if (messages.length === 0) return 'This message is no longer in Gmail.'
  const filed = messages.find(message => message.filed) ?? messages[messages.length - 1]
  const rest = messages.filter(message => message !== filed)
  const line = (message: LiveEmailMessage) => {
    const who = message.outbound ? 'Firm' : (message.from.name?.trim() || message.from.email)
    const when = new Date(message.receivedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    return `${who} · ${when}\n${message.bodyText.trim() || '(empty message)'}`
  }
  return [line(filed), ...(rest.length ? ['— earlier in this thread —', ...rest.map(line)] : [])].join('\n\n')
}
