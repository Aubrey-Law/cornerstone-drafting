import { NextResponse } from 'next/server'
import { CALCOM_MUTATING_EVENTS, type CalcomWebhookBody } from '@/lib/calcom/types'
import { bookingStatusFor, parseCalcomWebhook } from '@/lib/calcom/normalize'
import { processCalcomWebhook } from '@/lib/calcom/sync'
import { verifyCalcomSignature } from '@/lib/calcom/verify'

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

  return NextResponse.json({ received: true })
}
