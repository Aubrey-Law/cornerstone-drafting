import { NextResponse } from 'next/server'
import { parseCalendlyWebhook } from '@/lib/calendly/normalize'
import { processCalendlyWebhook } from '@/lib/calendly/sync'
import { verifyCalendlySignature, verifyCalendlyWebhookSecret } from '@/lib/calendly/verify'
import { CALENDLY_EVENTS, type CalendlyWebhookBody } from '@/lib/calendly/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const webhookSecret = process.env.CALENDLY_WEBHOOK_SECRET?.trim()
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim()
  if (!webhookSecret && !signingKey) {
    console.error('[calendly] missing webhook authentication configuration')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('calendly-webhook-signature')
  const suppliedSecret = new URL(req.url).searchParams.get('token')

  // Calendly API v2 webhook subscriptions do not currently expose a signing
  // key or send a documented HMAC header. Authenticate the high-entropy token
  // embedded in the subscribed callback URL. Retain HMAC support for legacy or
  // future signed deliveries without weakening the shared-secret path.
  const authenticated = Boolean(
    (webhookSecret && verifyCalendlyWebhookSecret(webhookSecret, suppliedSecret))
    || (signingKey && verifyCalendlySignature(rawBody, signingKey, signature)),
  )
  if (!authenticated) {
    return NextResponse.json({ error: 'invalid webhook authentication' }, { status: 401 })
  }

  let body: CalendlyWebhookBody
  try {
    body = JSON.parse(rawBody) as CalendlyWebhookBody
  } catch {
    console.error('[calendly] failed to parse body')
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!CALENDLY_EVENTS.includes(body.event as (typeof CALENDLY_EVENTS)[number])) {
    return NextResponse.json({ received: true, ignored: body.event })
  }

  const parsed = parseCalendlyWebhook(body)
  if (!parsed) {
    return NextResponse.json({ received: true })
  }

  // Calendly retries on any non-2xx or timeout, and processCalendlyWebhook
  // inserts matter notes and lead activity unconditionally, so a retry would
  // duplicate them. Claim the event first, as the Cal.com handler does.
  //
  // An invitee is created once and canceled once, so uid + event is already
  // unique per real occurrence; startTime is included for parity with the
  // Cal.com key scheme.
  const admin = getAdminClient()
  const eventId = `${parsed.bookingUid}:${parsed.event}:${parsed.startTime ?? ''}`

  const { data: claimed, error: claimError } = await admin.rpc('claim_webhook_event', {
    p_provider: 'calendly',
    p_event_id: eventId,
    p_event_type: parsed.event,
    // Identifiers only. Dedupe needs the key, not the booking body — storing
    // the raw payload would accumulate attendee name/email/phone in a ledger
    // with no retention policy. The booking is persisted by processCalendlyWebhook.
    p_payload: {
      inviteeUuid: parsed.bookingUid,
      eventSlug: parsed.eventSlug || null,
      action: parsed.action,
    },
    p_occurred_at: parsed.startTime ?? null,
  })

  if (claimError) {
    // Fail loudly so Calendly retries rather than silently skipping the booking.
    console.error('[calendly] claim error', { eventId, error: claimError })
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }

  if (claimed === false) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await processCalendlyWebhook(parsed)
  } catch (e) {
    // Release the claim so the provider's retry can reprocess; otherwise a
    // half-finished booking would be suppressed forever.
    await admin
      .rpc('release_webhook_event', { p_provider: 'calendly', p_event_id: eventId })
      .then(({ error }) => {
        if (error) console.error('[calendly] claim release failed', { eventId, error })
      })
    console.error('[calendly] processing failed', { eventId, error: e })
    return NextResponse.json({ error: 'processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
