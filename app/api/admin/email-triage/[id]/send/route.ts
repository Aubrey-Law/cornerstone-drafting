import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { GmailSendError, sendViaGmail } from '@/lib/email/gmailSend'
import { deleteGmailDraft } from '@/lib/email/gmailDraft'
import { applyTriageLabel } from '@/lib/email/gmailLabels'
import { triageLabelName } from '@/lib/emailTriage/labels'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { buildReplyHeaders } from '@/lib/email/replyHeaders'
import { logSend } from '@/lib/email/send'
import { envEmailsHardKilled, getAllSettings, isAllowed } from '@/lib/email/settings'
import { evaluateNeedsReply } from '@/lib/emailTriage/needsReply'
import { replySubject } from '@/lib/emailTriage/prompt'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow, type EmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

/**
 * Rows a reply can be sent from. `drafting` is left out: the scan holds that
 * claim while it writes a draft, and a send underneath it would be followed by
 * a fresh model draft on a thread that is already answered.
 */
const SENDABLE_STATUSES = ['needs_reply', 'drafted', 'approved', 'failed'] as const

function refuse(error: string, status = 409) {
  return NextResponse.json({ error }, { status })
}

/** The record the reply belongs to, so it lands on that timeline. One at most. */
function recordLink(row: EmailTriageRow) {
  if (row.classification === 'client' && row.matter_id) return { matter_id: row.matter_id }
  if (row.client_intake_id) return { lead_id: row.client_intake_id }
  if (row.contact_id) return { contact_id: row.contact_id }
  if (row.matter_id) return { matter_id: row.matter_id }
  return {}
}

// POST /api/admin/email-triage/[id]/send — send the reply shown on the triage
// page, from the attorney's own Gmail, on the original thread.
//
// The attorney's explicit click (behind a confirmation) is the review: what is
// sent is exactly the subject and body in the request, which is what the page
// shows, never a model draft the attorney has not seen. The "Create Gmail
// draft" path stays for anything that wants a last look in Gmail itself.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await consumeRateLimit(
    { bucket: 'email_triage_send', limit: 30, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(SENDABLE_STATUSES as readonly string[]).includes(row.status)) {
    return refuse(
      row.status === 'drafting'
        ? 'A draft is being written for this thread — wait for it, then send'
        : 'This thread has already been answered or dismissed',
    )
  }

  // Sent as shown: the page passes what is on screen, so an edit still waiting
  // on the autosave is not lost or, worse, silently replaced by the stored copy.
  const body = (await req.json().catch(() => ({}))) as { draftSubject?: unknown; draftBody?: unknown }
  const subject = typeof body.draftSubject === 'string' ? body.draftSubject : (row.draft_subject ?? '')
  const text = typeof body.draftBody === 'string' ? body.draftBody : (row.draft_body ?? '')
  if (!text.trim()) return refuse('There is no reply to send', 400)

  // The firm's kill switches apply here exactly as they do to every other send.
  // A refusal rather than a quiet suppression: the attorney is looking at the
  // button and needs to know the client did not get it.
  if (envEmailsHardKilled()) {
    return refuse('Email sending is switched off for this deployment. Create a Gmail draft instead.')
  }
  const { mode } = (await getAllSettings()).manual
  if (mode === 'off') {
    return refuse('Manual email is switched off in email settings. Create a Gmail draft instead.')
  }
  if (mode === 'redirect') {
    // Redirecting would post a test copy into the client's thread in the firm's
    // Sent Mail, which is worse than not sending at all.
    return refuse('Manual email is redirected to the test inbox, so this cannot go to the client. Create a Gmail draft instead.')
  }
  if (!isAllowed(row.sender_email)) {
    return refuse('This address is outside the email allowlist. Create a Gmail draft instead.')
  }

  const admin = getAdminClient()

  // The claim. A double click or a second tab would otherwise send the client
  // the same reply twice, and a sent email cannot be taken back. `replied_at`
  // is null on every open row (the scan clears it when it requeues a thread),
  // so setting it conditionally is a lock that needs no new column.
  const claimedAt = new Date().toISOString()
  const { data: claimed } = await admin
    .from('email_triage_threads')
    .update({ replied_at: claimedAt })
    .eq('id', id)
    .is('replied_at', null)
    .in('status', [...SENDABLE_STATUSES])
    .select('id')
  if (!claimed?.length) return refuse('This reply is already being sent')

  const release = () => admin
    .from('email_triage_threads')
    .update({ replied_at: null })
    .eq('id', id)
    .eq('replied_at', claimedAt)

  let sent: Awaited<ReturnType<typeof sendViaGmail>>
  let token: string
  try {
    const identity = await getMailboxIdentity(auth.userId)
    token = identity.token
    const thread = await getThread({ token, threadId: row.gmail_thread_id })
    if (!thread) {
      await release()
      return refuse('That thread is no longer in Gmail, so there is nothing to reply to')
    }

    // Read live, not from the row: the row is a scan old, and in between the
    // attorney may have answered from a phone or the client may have written
    // again. Either way this reply no longer fits the conversation.
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
        return refuse('This thread was already answered in Gmail, so nothing was sent')
      }
      await release()
      return refuse('This thread no longer needs a reply, so nothing was sent')
    }
    if (verdict.inboundMessageId !== row.gmail_message_id) {
      await release()
      return refuse('The sender has written again since this reply was drafted. Refresh, then review it before sending.')
    }
    const inbound = thread.messages.find(message => message.id === row.gmail_message_id)
    if (!inbound) {
      await release()
      return refuse('That message is no longer in Gmail, so there is nothing to reply to')
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
      userId: auth.userId,
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
    return NextResponse.json({ error: detail }, { status: missingScope ? 403 : 502 })
  }

  // Everything below is bookkeeping after a delivered email. None of it may
  // turn into an error response: the client has the reply, and telling the
  // attorney otherwise invites a second send.
  const notices: string[] = []
  if (sent.threadId && sent.threadId !== row.gmail_thread_id) {
    notices.push('Gmail filed the reply as a new conversation rather than on the original thread.')
  }

  // The earlier Gmail draft, if there was one, is now a duplicate of a sent
  // reply — left behind, it is one click from going out a second time.
  let draftRemoved = !row.gmail_draft_id
  if (row.gmail_draft_id) {
    draftRemoved = await deleteGmailDraft(row.gmail_draft_id, auth.userId).then(() => true, () => false)
    if (!draftRemoved) notices.push('The earlier Gmail draft could not be removed — delete it in Gmail so it is not sent twice.')
  }

  let label: string | null = null
  try {
    label = await applyTriageLabel({ token, threadId: row.gmail_thread_id, classification: row.classification })
  } catch (error) {
    notices.push(
      `The ${triageLabelName(row.classification) ?? ''} label could not be applied: `
      + (error instanceof Error ? error.message : String(error)),
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

  return NextResponse.json({
    sent: true,
    messageId: sent.messageId,
    from: sent.fromAddress,
    label,
    notices,
  })
}
