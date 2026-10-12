import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

// GET /api/admin/email-triage/[id]/message — the thread, read live from Gmail.
//
// This route exists because message bodies are deliberately not stored (see the
// migration header): the mailbox stays the system of record, and Cornerstone
// holds Gmail's snippet and nothing more. The cost is this fetch when a row is
// opened.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await consumeRateLimit(
    { bucket: 'email_triage_message', limit: 120, windowSeconds: 600 },
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

  try {
    const identity = await getMailboxIdentity(auth.userId)
    const thread = await getThread({ token: identity.token, threadId: row.gmail_thread_id })
    if (!thread) return NextResponse.json({ messages: [], gone: true })

    return NextResponse.json({
      messages: thread.messages
        .filter(message => !message.labelIds.includes('DRAFT'))
        .map(message => ({
          id: message.id,
          from: message.from,
          receivedAt: message.receivedAt,
          bodyText: message.bodyText,
          attachments: message.attachments,
          outbound: message.labelIds.includes('SENT')
            || message.from.email === identity.address,
        })),
    })
  } catch (error) {
    if (error instanceof GmailReadError) {
      // 'gone' rather than an error: a thread deleted between the scan and the
      // click is an ordinary outcome the page can render.
      const status = error.kind === 'missing_scope' ? 403 : 502
      return NextResponse.json({ error: error.message, kind: error.kind }, { status })
    }
    throw error
  }
}
