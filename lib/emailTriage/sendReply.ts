import type { SupabaseClient } from '@supabase/supabase-js'
import { GmailSendError, sendViaGmail } from '@/lib/email/gmailSend'
import { deleteGmailDraft } from '@/lib/email/gmailDraft'
import { triageLabelName } from '@/lib/emailTriage/labels'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { buildReplyHeaders } from '@/lib/email/replyHeaders'
import { logSend } from '@/lib/email/send'
import { envEmailsHardKilled, getAllSettings, isAllowed } from '@/lib/email/settings'
import { evaluateNeedsReply } from '@/lib/emailTriage/needsReply'
import { replySubject } from '@/lib/emailTriage/prompt'
import type { EmailTriageRow } from '@/lib/queries/emailTriage'

/**
 * Sending a triaged reply, shared by the triage page's "Send reply" button and
 * the `email.triage.reply.send` registry action the delegation dial runs.
 *
 * Both paths send from the attorney's own Gmail, on the original thread, after
 * re-reading the conversation live: the stored row is a scan old, and in
 * between the attorney may have answered from a phone or the client may have
 * written again. The claim on `replied_at` makes a double click, a second tab,
 * or a cron run beside a click send at most once.
 */

/**
 * Rows a reply can be sent from. `drafting` is left out: the scan holds that
 * claim while it writes a draft, and a send underneath it would be followed by
 * a fresh model draft on a thread that is already answered.
 */
export const SENDABLE_STATUSES = ['needs_reply', 'drafted', 'approved', 'failed'] as const

export function isSendableStatus(status: string): boolean {
  return (SENDABLE_STATUSES as readonly string[]).includes(status)
}

export function unsendableReason(status: string): string {
  return status === 'drafting'
    ? 'A draft is being written for this thread — wait for it, then send'
    : 'This thread has already been answered or dismissed'
}

/** The record the reply belongs to, so it lands on that timeline. One at most. */
export function recordLink(row: EmailTriageRow) {
  if (row.classification === 'client' && row.matter_id) return { matter_id: row.matter_id }
  if (row.client_intake_id) return { lead_id: row.client_intake_id }
  if (row.contact_id) return { contact_id: row.contact_id }
  if (row.matter_id) return { matter_id: row.matter_id }
  return {}
}

/**
 * The firm's kill switches apply here exactly as they do to every other send.
 * Returns the reason to refuse, or null when sending is allowed.
 */
export async function triageSendPolicyRefusal(row: Pick<EmailTriageRow, 'sender_email'>): Promise<string | null> {
  if (envEmailsHardKilled()) {
    return 'Email sending is switched off for this deployment. Create a Gmail draft instead.'
  }
  const { mode } = (await getAllSettings()).manual
  if (mode === 'off') {
    return 'Manual email is switched off in email settings. Create a Gmail draft instead.'
  }
  if (mode === 'redirect') {
    // Redirecting would post a test copy into the client's thread in the firm's
    // Sent Mail, which is worse than not sending at all.
    return 'Manual email is redirected to the test inbox, so this cannot go to the client. Create a Gmail draft instead.'
  }
  if (!isAllowed(row.sender_email)) {
    return 'This address is outside the email allowlist. Create a Gmail draft instead.'
  }
  return null
}

export type TriageSendOutcome =
  | { ok: true; messageId: string | null; from: string | null; label: string | null; notices: string[] }
  | { ok: false; refusal: string; status: 400 | 409 }

/** Gmail refused or failed. The row already carries `Not sent: …`. */
export class TriageSendError extends Error {
  constructor(message: string, readonly missingScope: boolean) {
    super(message)
    this.name = 'TriageSendError'
  }
}

export async function sendTriageReply(args: {
  admin: SupabaseClient
  row: EmailTriageRow
  subject: string
  text: string
  userId: string
}): Promise<TriageSendOutcome> {
  const { admin, row, subject, text, userId } = args
  const id = row.id
  if (!text.trim()) return { ok: false, refusal: 'There is no reply to send', status: 400 }

  const policyRefusal = await triageSendPolicyRefusal(row)
  if (policyRefusal) return { ok: false, refusal: policyRefusal, status: 409 }

  // The claim. `replied_at` is null on every open row (the scan clears it when
  // it requeues a thread), so setting it conditionally is a lock that needs no
  // new column.
  const claimedAt = new Date().toISOString()
  const { data: claimed } = await admin
    .from('email_triage_threads')
    .update({ replied_at: claimedAt })
    .eq('id', id)
    .is('replied_at', null)
    .in('status', [...SENDABLE_STATUSES])
    .select('id')
  if (!claimed?.length) return { ok: false, refusal: 'This reply is already being sent', status: 409 }

  const release = () => admin
    .from('email_triage_threads')
    .update({ replied_at: null })
    .eq('id', id)
    .eq('replied_at', claimedAt)

  let sent: Awaited<ReturnType<typeof sendViaGmail>>
  let token: string
  try {
    const identity = await getMailboxIdentity(userId)
    token = identity.token
    const thread = await getThread({ token, threadId: row.gmail_thread_id })
    if (!thread) {
      await release()
      return { ok: false, refusal: 'That thread is no longer in Gmail, so there is nothing to reply to', status: 409 }
    }

    const verdict = evaluateNeedsReply({
      connectedAddress: identity.address,
      ownDraftMessageIds: row.gmail_draft_message_id ? [row.gmail_draft_message_id] : [],
      thread,
    })
    if (!verdict.needsReply) {
      if (verdict.reason === 'already_replied') {
        const now = new Date().toISOString()
        await admin
          .from('email_triage_threads')
          .update({ status: 'replied', replied_at: now, updated_at: now })
          .eq('id', id)
        return { ok: false, refusal: 'This thread was already answered in Gmail, so nothing was sent', status: 409 }
      }
      await release()
      return { ok: false, refusal: 'This thread no longer needs a reply, so nothing was sent', status: 409 }
    }
    if (verdict.inboundMessageId !== row.gmail_message_id) {
      await release()
      return { ok: false, refusal: 'The sender has written again since this reply was drafted. Refresh, then review it before sending.', status: 409 }
    }
    const inbound = thread.messages.find(message => message.id === row.gmail_message_id)
    if (!inbound) {
      await release()
      return { ok: false, refusal: 'That message is no longer in Gmail, so there is nothing to reply to', status: 409 }
    }

    // Kept on the row before sending, so the page and the log agree on what
    // went out even if a later write fails.
    await admin
      .from('email_triage_threads')
      .update({ draft_subject: subject, draft_body: text, updated_at: new Date().toISOString() })
      .eq('id', id)

    sent = await sendViaGmail({
      to: row.sender_email,
      subject: replySubject(subject || row.subject),
      text,
      threadId: row.gmail_thread_id,
      ...buildReplyHeaders({
        messageId: inbound.messageIdHeader,
        references: inbound.references,
        inReplyTo: inbound.inReplyTo,
      }),
      userId,
    })
  } catch (error) {
    await release()
    const detail = error instanceof Error ? error.message : String(error)
    await admin
      .from('email_triage_threads')
      .update({ draft_error: `Not sent: ${detail}`, updated_at: new Date().toISOString() })
      .eq('id', id)
    const missingScope =
      (error instanceof GmailSendError || error instanceof GmailReadError)
      && error.kind === 'missing_scope'
    throw new TriageSendError(detail, missingScope)
  }

  // Everything below is bookkeeping after a delivered email. None of it may
  // turn into an error: the client has the reply, and reporting a failure
  // invites a second send.
  const notices: string[] = []
  if (sent.threadId && sent.threadId !== row.gmail_thread_id) {
    notices.push('Gmail filed the reply as a new conversation rather than on the original thread.')
  }

  let draftRemoved = !row.gmail_draft_id
  if (row.gmail_draft_id) {
    draftRemoved = await deleteGmailDraft(row.gmail_draft_id, userId).then(() => true, () => false)
    if (!draftRemoved) notices.push('The earlier Gmail draft could not be removed — delete it in Gmail so it is not sent twice.')
  }

  let label: string | null = null
  const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
  const sorted = await applyAndRecordMailboxSort({
    token,
    threadId: row.gmail_thread_id,
    kind: 'handled',
    classification: row.classification,
    archiveEnabled,
    triageRowId: id,
  })
  label = sorted.label
  if (sorted.error) {
    notices.push(
      `The ${triageLabelName(row.classification) ?? 'Cornerstone'} label could not be applied: `
      + sorted.error,
    )
  }

  const finalSubject = replySubject(subject || row.subject)
  await logSend({
    ...recordLink(row),
    category: 'manual',
    to_email: row.sender_email,
    intended_to: row.sender_email,
    actual_to: row.sender_email,
    subject: finalSubject,
    reply_to: null,
    cc: null,
    bcc: null,
    html: text,
    provider: 'gmail',
    provider_message_id: sent.messageId,
    status: 'sent',
    error: null,
  })

  const now = new Date().toISOString()
  await admin
    .from('email_triage_threads')
    .update({
      status: 'replied',
      replied_at: now,
      ...(draftRemoved ? { gmail_draft_id: null, gmail_draft_message_id: null } : {}),
      draft_error: notices.length ? notices.join(' ') : null,
      updated_at: now,
    })
    .eq('id', id)

  return { ok: true, messageId: sent.messageId ?? null, from: sent.fromAddress ?? null, label, notices }
}
