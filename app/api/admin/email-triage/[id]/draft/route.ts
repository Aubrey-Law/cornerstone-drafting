import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { generateTriageDraft } from '@/lib/emailTriage/draft'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/email-triage/[id]/draft — generate or regenerate one draft.
// The same generator the cron uses, so a Regenerate and a morning batch produce
// the same thing from the same prompt.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await consumeRateLimit(
    { bucket: 'email_triage_draft', limit: 40, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { notes?: unknown }
  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = getAdminClient()
  try {
    const identity = await getMailboxIdentity(auth.userId)
    const thread = await getThread({ token: identity.token, threadId: row.gmail_thread_id })
    const inbound = thread?.messages.find(message => message.id === row.gmail_message_id)
    if (!inbound) {
      return NextResponse.json({ error: 'That message is no longer in Gmail' }, { status: 409 })
    }

    const draft = await generateTriageDraft({
      classification: row.classification,
      clientIntakeId: row.client_intake_id,
      matterId: row.matter_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      subject: row.subject,
      receivedAt: row.received_at,
      bodyText: inbound.bodyText,
      notes: typeof body.notes === 'string' ? body.notes : null,
      userId: auth.userId,
      route: 'admin/email-triage',
    })

    await admin
      .from('email_triage_threads')
      .update({
        status: 'drafted',
        draft_subject: draft.subject,
        draft_body: draft.body,
        draft_model: draft.model,
        draft_generated_at: new Date().toISOString(),
        draft_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({ row: await fetchEmailTriageRow(id) })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // The row keeps its place with the reason attached. The thread still needs
    // a reply; only the drafting of one failed.
    await admin
      .from('email_triage_threads')
      .update({ status: 'failed', draft_error: detail, updated_at: new Date().toISOString() })
      .eq('id', id)

    const status = error instanceof GmailReadError && error.kind === 'missing_scope' ? 403 : 500
    return NextResponse.json({ error: detail }, { status })
  }
}
