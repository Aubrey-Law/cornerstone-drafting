import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  RESEND_STATUS_EVENTS,
  isResendStatusEvent,
  shouldApplyStatus,
  verifyResendWebhookSignature,
} from '@/lib/email/resendWebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/resend — delivery outcomes for mail sent through Resend.
 * Register https://{app}/api/webhooks/resend in the Resend dashboard.
 *
 * This exists so bounces and complaints stop being invisible. The domain that
 * carries engagement-agreement signing links and invoices is the same one
 * marketing will eventually send from, and an unread complaint stream is how a
 * sending reputation degrades without anyone noticing.
 *
 * Rows are matched on email_log.provider_message_id, which holds the id Resend
 * returned at send time. Status is applied by precedence, not arrival order —
 * see lib/email/resendWebhook.ts.
 */

/** Why a send failed, when the event carries a reason worth keeping. */
function failureReason(type: string, data: Record<string, unknown>): string | null {
  const bounce = data.bounce as { message?: string; type?: string; subType?: string } | undefined
  if (bounce) {
    const detail = [bounce.type, bounce.subType].filter(Boolean).join('/')
    return [`${type}:`, detail, bounce.message].filter(Boolean).join(' ') || type
  }
  const failed = data.failed as { reason?: string } | undefined
  if (failed?.reason) return `${type}: ${failed.reason}`
  if (type === 'email.complained') return 'email.complained: recipient marked this as spam'
  return null
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SIGNING_SECRET?.trim()
  if (!secret) {
    console.error('[resend webhook] missing RESEND_WEBHOOK_SIGNING_SECRET')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  if (
    !verifyResendWebhookSignature({
      payload: rawBody,
      svixId: req.headers.get('svix-id'),
      svixTimestamp: req.headers.get('svix-timestamp'),
      svixSignature: req.headers.get('svix-signature'),
      secret,
    })
  ) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: { type?: unknown; data?: unknown }
  try {
    body = JSON.parse(rawBody) as { type?: unknown; data?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const type = typeof body.type === 'string' ? body.type : null
  if (!type) return NextResponse.json({ error: 'missing event type' }, { status: 400 })

  // Contact, domain and suppression events carry no email_log row to update.
  // Ack them: Resend retries every non-2xx, and there is nothing to retry for.
  if (!isResendStatusEvent(type)) {
    return NextResponse.json({ ok: true, ignored: type })
  }

  const data = (body.data ?? {}) as Record<string, unknown>
  const emailId = typeof data.email_id === 'string' ? data.email_id : null
  if (!emailId) {
    return NextResponse.json({ error: 'missing data.email_id' }, { status: 400 })
  }

  const nextStatus = RESEND_STATUS_EVENTS[type]
  const admin = getAdminClient()

  // Read the current status, then write only if it has not changed underneath
  // us. Resend can deliver two outcomes for one message near-simultaneously,
  // and the precedence rule is only honoured if the row we rank against is the
  // row we write to. One retry covers the realistic collision; a second loser
  // means a higher-ranked status already landed, which is the outcome we want.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: rows, error: lookupError } = await admin
      .from('email_log')
      .select('id, status, error')
      .eq('provider_message_id', emailId)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(1)
    if (lookupError) {
      console.error('[resend webhook] email_log lookup failed', lookupError)
      return NextResponse.json({ error: 'email lookup failed' }, { status: 500 })
    }

    const row = rows?.[0]
    // Mail sent before this handler existed, or from another Resend project,
    // has no row here. Ack so Resend stops retrying.
    if (!row) return NextResponse.json({ ok: true, ignored: 'unknown email id' })

    const current = row.status as string | null
    if (!shouldApplyStatus(current, nextStatus)) {
      return NextResponse.json({ ok: true, unchanged: current })
    }

    const reason = failureReason(type, data)
    const { data: updated, error: updateError } = await admin
      .from('email_log')
      .update({
        status: nextStatus,
        // Keep whatever sendEmail already recorded; a delivery outcome should
        // add detail, not erase the send-time error that may explain it.
        ...(reason && !row.error ? { error: reason } : {}),
      })
      .eq('id', row.id as string)
      .eq('status', current as string)
      .select('id')
    if (updateError) {
      console.error('[resend webhook] email_log update failed', updateError)
      return NextResponse.json({ error: 'email update failed' }, { status: 500 })
    }
    if (updated && updated.length > 0) {
      return NextResponse.json({ ok: true, status: nextStatus })
    }
  }

  return NextResponse.json({ ok: true, unchanged: 'concurrent update' })
}
