import { NextResponse } from 'next/server'
import { CALCOM_MUTATING_EVENTS, type CalcomWebhookBody } from '@/lib/calcom/types'
import { bookingStatusFor, parseCalcomWebhook } from '@/lib/calcom/normalize'
import { processCalcomWebhook } from '@/lib/calcom/sync'
import { verifyCalcomSignature } from '@/lib/calcom/verify'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[calcom] missing CALCOM_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-cal-signature-256')

  let body: CalcomWebhookBody
  try {
    body = JSON.parse(rawBody) as CalcomWebhookBody
  } catch {
    console.error('[calcom] failed to parse body')
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { triggerEvent } = body
  const isMutating = CALCOM_MUTATING_EVENTS.includes(
    triggerEvent as (typeof CALCOM_MUTATING_EVENTS)[number],
  )

  if (signature !== null) {
    if (!verifyCalcomSignature(rawBody, secret, signature)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  } else if (isMutating) {
    console.warn('[calcom] signature required for', triggerEvent)
    return NextResponse.json({ error: 'signature required' }, { status: 401 })
  }

  if (!isMutating) {
    return NextResponse.json({ received: true, ignored: triggerEvent })
  }

  const parsed = parseCalcomWebhook(body)
  if (!parsed) {
    return NextResponse.json({ received: true })
  }

  // Cal.com retries on any non-2xx or timeout, and processCalcomWebhook inserts
  // matter notes and lead activity unconditionally, so a retry duplicated them —
  // and two near-simultaneous deliveries could create two leads for one person.
  // Claim the event first, the way the Telnyx and Firma handlers already do.
  //
  // The key includes startTime so a genuine second reschedule of the same booking
  // is still processed; only an identical redelivery is suppressed.
  const admin = getAdminClient()
  const eventId = `${parsed.bookingUid}:${parsed.triggerEvent}:${parsed.startTime ?? ''}`

  const { data: claimed, error: claimError } = await admin.rpc('claim_webhook_event', {
    p_provider: 'calcom',
    p_event_id: eventId,
    p_event_type: parsed.triggerEvent,
    // Identifiers only. Dedupe needs the key, not the booking body — storing the
    // raw payload would accumulate attendee name/email/phone in a ledger that has
    // no retention policy. The booking itself is persisted by processCalcomWebhook.
    p_payload: {
      bookingUid: parsed.bookingUid,
      bookingId: parsed.bookingId ?? null,
      eventSlug: parsed.eventSlug ?? null,
    },
    p_occurred_at: parsed.startTime ?? null,
  })

  if (claimError) {
    // Fail loudly so Cal.com retries rather than silently skipping the booking.
    console.error('[calcom] claim error', { eventId, error: claimError })
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }

  if (claimed === false) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await processCalcomWebhook({
      triggerEvent: parsed.triggerEvent,
      bookingUid: parsed.bookingUid,
      bookingId: parsed.bookingId,
      attendeeEmail: parsed.attendeeEmail,
      attendeeName: parsed.attendeeName,
      eventKey: parsed.eventKey,
      eventSlug: parsed.eventSlug,
      eventLabel: parsed.eventLabel,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      metadataLeadId: parsed.metadataLeadId,
      metadataMatterId: parsed.metadataMatterId,
      payload: body.payload ?? {},
      rawBody: body,
      status: bookingStatusFor(parsed.triggerEvent),
    })
  } catch (e) {
    // Release the claim so the provider's retry can reprocess; otherwise a
    // half-finished booking would be suppressed forever.
    await admin
      .rpc('release_webhook_event', { p_provider: 'calcom', p_event_id: eventId })
      .then(({ error }) => {
        if (error) console.error('[calcom] claim release failed', { eventId, error })
      })
    console.error('[calcom] processing failed', { eventId, error: e })
    return NextResponse.json({ error: 'processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
