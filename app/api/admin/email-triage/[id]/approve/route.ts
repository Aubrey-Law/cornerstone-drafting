import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { GmailSendError } from '@/lib/email/gmailSend'
import { createGmailDraft, deleteGmailDraft } from '@/lib/email/gmailDraft'
import { triageLabelName } from '@/lib/emailTriage/labels'
import { applyAndRecordMailboxSort, loadArchiveNonClientEnabled } from '@/lib/emailTriage/mailboxSort'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { buildReplyHeaders } from '@/lib/email/replyHeaders'
import { replySubject } from '@/lib/emailTriage/prompt'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

// POST /api/admin/email-triage/[id]/approve — put the drafted reply into Gmail
// as a draft on the original thread.
//
// A draft, not a send. Nothing here delivers mail to a client: the attorney
// reviews it in Gmail and sends it from there. Sending from the triage page is
// a separate route (`../send`), behind its own confirmation, so a generated
// reply still never reaches a client without a deliberate click on its text.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await consumeRateLimit(
    { bucket: 'email_triage_approve', limit: 30, windowSeconds: 600 },
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
  if (!row.draft_body?.trim()) {
    return NextResponse.json({ error: 'There is no draft to put in Gmail' }, { status: 400 })
  }

  const admin = getAdminClient()
  try {
    // The reply headers are read from Gmail rather than from the stored row:
    // they must describe the message actually being answered, and the stored
    // copy could be a scan old if the client wrote again in between.
    const identity = await getMailboxIdentity(auth.userId)
    const thread = await getThread({ token: identity.token, threadId: row.gmail_thread_id })
    const inbound = thread?.messages.find(message => message.id === row.gmail_message_id)
    if (!inbound) {
      return NextResponse.json(
        { error: 'That message is no longer in Gmail, so there is nothing to reply to' },
        { status: 409 },
      )
    }

    // Replacing an earlier draft rather than leaving the attorney two on one
    // thread. A failure here is not worth blocking the new draft over — the
    // stale one is visible in Gmail and removable by hand.
    if (row.gmail_draft_id) {
      await deleteGmailDraft(row.gmail_draft_id, auth.userId).catch(() => {})
    }

    const created = await createGmailDraft({
      to: row.sender_email,
      subject: replySubject(row.draft_subject ?? row.subject),
      text: row.draft_body,
      threadId: row.gmail_thread_id,
      ...buildReplyHeaders({
        messageId: inbound.messageIdHeader,
        references: inbound.references,
        inReplyTo: inbound.inReplyTo,
      }),
      userId: auth.userId,
    })

    // Handled + relationship label + archive. The draft lives under Drafts;
    // labelling failure is reported rather than failing the approval.
    const archiveEnabled = await loadArchiveNonClientEnabled().catch(() => true)
    const sorted = await applyAndRecordMailboxSort({
      token: identity.token,
      threadId: row.gmail_thread_id,
      kind: 'handled',
      classification: row.classification,
      archiveEnabled,
      triageRowId: id,
    })
    const label = sorted.label
    const labelError = sorted.error
    const labelNotice = labelError
      ? `The draft is in Gmail, but the ${triageLabelName(row.classification) ?? 'Cornerstone'} label could not be applied: ${labelError}`
      : null

    const now = new Date().toISOString()
    await admin
      .from('email_triage_threads')
      .update({
        status: 'approved',
        gmail_draft_id: created.draftId,
        gmail_draft_message_id: created.messageId,
        approved_at: now,
        approved_by: auth.userId,
        draft_error: labelNotice,
        updated_at: now,
      })
      .eq('id', id)

    return NextResponse.json({
      row: await fetchEmailTriageRow(id),
      draftId: created.draftId,
      messageId: created.messageId,
      label,
      labelError,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await admin
      .from('email_triage_threads')
      .update({ draft_error: detail, updated_at: new Date().toISOString() })
      .eq('id', id)

    const missingScope =
      (error instanceof GmailSendError || error instanceof GmailReadError)
      && error.kind === 'missing_scope'
    return NextResponse.json({ error: detail }, { status: missingScope ? 403 : 502 })
  }
}
