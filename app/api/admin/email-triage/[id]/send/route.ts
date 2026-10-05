import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'
import {
  TriageSendError,
  isSendableStatus,
  sendTriageReply,
  unsendableReason,
} from '@/lib/emailTriage/sendReply'

export const dynamic = 'force-dynamic'

function refuse(error: string, status = 409) {
  return NextResponse.json({ error }, { status })
}

// POST /api/admin/email-triage/[id]/send — send the reply shown on the triage
// page, from the attorney's own Gmail, on the original thread.
//
// The attorney's explicit click (behind a confirmation) is the review: what is
// sent is exactly the subject and body in the request, which is what the page
// shows, never a model draft the attorney has not seen. The "Create Gmail
// draft" path stays for anything that wants a last look in Gmail itself. The
// send itself lives in lib/emailTriage/sendReply.ts, shared with the
// delegation dial's `email.triage.reply.send` action.
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
  if (!isSendableStatus(row.status)) return refuse(unsendableReason(row.status))

  // Sent as shown: the page passes what is on screen, so an edit still waiting
  // on the autosave is not lost or, worse, silently replaced by the stored copy.
  const body = (await req.json().catch(() => ({}))) as { draftSubject?: unknown; draftBody?: unknown }
  const subject = typeof body.draftSubject === 'string' ? body.draftSubject : (row.draft_subject ?? '')
  const text = typeof body.draftBody === 'string' ? body.draftBody : (row.draft_body ?? '')

  try {
    const outcome = await sendTriageReply({ admin: getAdminClient(), row, subject, text, userId: auth.userId })
    if (!outcome.ok) return refuse(outcome.refusal, outcome.status)
    return NextResponse.json({
      sent: true,
      messageId: outcome.messageId,
      from: outcome.from,
      label: outcome.label,
      notices: outcome.notices,
    })
  } catch (error) {
    if (error instanceof TriageSendError) {
      return NextResponse.json({ error: error.message }, { status: error.missingScope ? 403 : 502 })
    }
    throw error
  }
}
