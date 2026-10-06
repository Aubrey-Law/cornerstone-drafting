import type { GmailMessageSummary, GmailThreadSummary } from '@/lib/email/gmailRead'
import type { getAdminClient } from '@/lib/supabaseAdmin'
import { emailDomain, type SenderMatch } from './classifySender'

type AdminClient = ReturnType<typeof getAdminClient>

/**
 * Filing inbound mail on the record.
 *
 * The scan reads every thread in the mailbox window to find what is waiting
 * on a reply. On the way past it now files the inbound messages whose sender
 * it can place, so a matter, lead or contact shows the mail it received and
 * not only the mail the firm sent. Snippets and ids only: the body is read
 * live from Gmail when the attorney opens the message from the record.
 */

/** Only mail from a person the firm has a record of is filed on that record. */
export const FILED_CLASSIFICATIONS = new Set<SenderMatch['classification']>(['client', 'lead', 'contact'])

/**
 * One thread can carry a year of back-and-forth; the newest few are what a
 * record needs, and the rest are a click away in Gmail.
 */
export const MAX_FILED_PER_THREAD = 10

/** A message the firm sent, by label or by address. */
export function isOutboundMessage(
  message: Pick<GmailMessageSummary, 'from' | 'labelIds'>,
  connectedAddress: string,
  firmDomains: string[],
): boolean {
  const from = message.from.email.toLowerCase()
  return message.labelIds.includes('SENT')
    || from === connectedAddress.toLowerCase()
    || firmDomains.some(domain => emailDomain(from) === domain.toLowerCase())
}

/**
 * The newest message in the thread that the firm did not send. Its sender is
 * who the thread is "with", and the one address worth classifying.
 */
export function latestInboundMessage(
  thread: GmailThreadSummary,
  connectedAddress: string,
  firmDomains: string[],
): GmailMessageSummary | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i]
    if (!isOutboundMessage(message, connectedAddress, firmDomains)) return message
  }
  return null
}

/**
 * The inbound messages from one sender in a thread, newest first and capped.
 * Pure, so the rule for what lands on a record is tested without a mailbox.
 */
export function inboundMessagesFrom(
  thread: GmailThreadSummary,
  senderEmail: string,
  connectedAddress: string,
  firmDomains: string[],
): GmailMessageSummary[] {
  const sender = senderEmail.toLowerCase()
  return [...thread.messages]
    .reverse()
    .filter(message =>
      !isOutboundMessage(message, connectedAddress, firmDomains)
      && message.from.email.toLowerCase() === sender
      && !message.labelIds.includes('DRAFT'))
    .slice(0, MAX_FILED_PER_THREAD)
}

export interface InboundFilingRow {
  connection_email: string
  gmail_thread_id: string
  gmail_message_id: string
  message_id_header: string | null
  sender_email: string
  sender_name: string | null
  subject: string | null
  snippet: string | null
  received_at: string
  classification: 'client' | 'lead' | 'contact'
  client_intake_id: string | null
  matter_id: string | null
  contact_id: string | null
  updated_at: string
}

/** The rows one thread contributes, or none when the sender is not on file. */
export function inboundFilingRows(input: {
  thread: GmailThreadSummary
  sender: GmailMessageSummary
  match: SenderMatch
  connectedAddress: string
  firmDomains: string[]
  now?: Date
}): InboundFilingRow[] {
  if (!FILED_CLASSIFICATIONS.has(input.match.classification)) return []
  const updatedAt = (input.now ?? new Date()).toISOString()
  return inboundMessagesFrom(input.thread, input.sender.from.email, input.connectedAddress, input.firmDomains)
    .map(message => ({
      connection_email: input.connectedAddress.toLowerCase(),
      gmail_thread_id: input.thread.id,
      gmail_message_id: message.id,
      message_id_header: message.messageIdHeader,
      sender_email: message.from.email.toLowerCase(),
      sender_name: input.match.displayName ?? message.from.name,
      subject: message.subject || null,
      snippet: message.snippet || null,
      received_at: message.receivedAt,
      classification: input.match.classification as 'client' | 'lead' | 'contact',
      client_intake_id: input.match.clientIntakeId,
      matter_id: input.match.matterId,
      contact_id: input.match.contactId,
      updated_at: updatedAt,
    }))
}

/**
 * Whether a storage error means the table is not there yet. Code and
 * migrations deploy in no guaranteed order, so until 20270110090000 lands the
 * scan files nothing rather than failing.
 */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/**
 * Upsert the rows. Returns how many were written; a missing table is reported
 * as `unavailable` once so the caller can stop trying for the rest of the run.
 */
export async function fileInboundMessages(
  admin: AdminClient,
  rows: InboundFilingRow[],
): Promise<{ filed: number; unavailable: boolean }> {
  if (rows.length === 0) return { filed: 0, unavailable: false }
  const { error } = await admin
    .from('email_inbound_messages')
    .upsert(rows, { onConflict: 'connection_email,gmail_message_id' })
  if (error) {
    if (isMissingTableError(error)) return { filed: 0, unavailable: true }
    throw error
  }
  return { filed: rows.length, unavailable: false }
}
