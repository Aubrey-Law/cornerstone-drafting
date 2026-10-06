import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { GmailReadError, getMailboxIdentity, getThread } from '@/lib/email/gmailRead'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'

export const dynamic = 'force-dynamic'

// GET /api/admin/comms/email-inbound/[id] — one filed inbound message, read
// live from Gmail.
//
// The record stores Gmail's snippet and nothing more (see the migration
// header on email_inbound_messages), so opening a message from a matter, lead
// or contact costs this fetch. The whole thread comes back so the reply chain
// reads in order; the filed message is marked.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await consumeRateLimit(
    { bucket: 'email_inbound_message', limit: 120, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: row, error } = await getAdminClient()
    .from('email_inbound_messages')
    .select('id, gmail_thread_id, gmail_message_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'The message record is unavailable' }, { status: 500 })
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
          subject: message.subject,
          receivedAt: message.receivedAt,
          bodyText: message.bodyText,
          outbound: message.labelIds.includes('SENT') || message.from.email === identity.address,
          filed: message.id === row.gmail_message_id,
        })),
    })
  } catch (caught) {
    if (caught instanceof GmailReadError) {
      // A thread deleted in Gmail since it was filed is an ordinary outcome
      // the record can show; a missing scope is the one that needs a person.
      const status = caught.kind === 'missing_scope' ? 403 : 502
      return NextResponse.json({ error: caught.message, kind: caught.kind }, { status })
    }
    throw caught
  }
}
