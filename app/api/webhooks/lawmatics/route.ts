import { NextResponse, after } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isLawmaticsCalendarImportEnabled, syncLawmaticsCalendar } from '@/lib/integrations/lawmatics/inbound'
import { isFormSubmissionEvent, verifyLawmaticsSignature } from '@/lib/integrations/lawmatics/webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface LawmaticsWebhookEnvelope {
  event_id?: unknown
  event_type?: unknown
  timestamp?: unknown
}

/**
 * Lawmatics outbound webhook. Lawmatics sends no appointment events, but a
 * booking form's submission creates the Lawmatics event, so a `form.submitted`
 * delivery triggers the calendar import right away instead of waiting for the
 * next scheduled run. The delivery is only a nudge: the import reads the
 * events themselves from the Lawmatics API.
 */
export async function POST(req: Request) {
  const secret = process.env.LAWMATICS_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[lawmatics-webhook] missing LAWMATICS_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const valid = verifyLawmaticsSignature({
    rawBody,
    secret,
    signature: req.headers.get('x-lawmatics-signature'),
    timestamp: req.headers.get('x-lawmatics-timestamp'),
  })
  if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let body: LawmaticsWebhookEnvelope
  try {
    body = JSON.parse(rawBody) as LawmaticsWebhookEnvelope
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventType = typeof body.event_type === 'string' ? body.event_type : ''
  if (!isFormSubmissionEvent(eventType)) {
    return NextResponse.json({ received: true, ignored: eventType || 'unknown' })
  }
  if (!isLawmaticsCalendarImportEnabled()) {
    return NextResponse.json({ received: true, ignored: 'calendar import disabled' })
  }

  // Lawmatics may deliver an event more than once; event_id is its idempotency key.
  const eventId = typeof body.event_id === 'string' && body.event_id.trim() ? body.event_id.trim() : null
  if (eventId) {
    const { data: claimed, error } = await getAdminClient().rpc('claim_webhook_event', {
      p_provider: 'lawmatics',
      p_event_id: `webhook:${eventId}`,
      p_event_type: eventType,
      p_payload: { eventId, eventType },
      p_occurred_at: typeof body.timestamp === 'string' ? body.timestamp : null,
    })
    if (error) {
      console.error('[lawmatics-webhook] claim error', { eventId, error })
      return NextResponse.json({ error: 'claim failed' }, { status: 500 })
    }
    if (claimed === false) return NextResponse.json({ received: true, duplicate: true })
  }

  // Acknowledge first; the import pages through the Lawmatics API. Its own
  // per-event claims make an overlap with the scheduled run harmless, and the
  // scheduled run picks up anything this one misses.
  after(async () => {
    try {
      const result = await syncLawmaticsCalendar()
      console.info('[lawmatics-webhook] calendar import', result)
    } catch (error) {
      console.error('[lawmatics-webhook] calendar import failed', { eventId, error })
    }
  })

  return NextResponse.json({ received: true })
}
