import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { unwrapTelnyxWebhook } from '@/lib/telnyx/client'
import {
  isSmsOptOutMessage,
  recordInboundSms,
  smsOptOutConfirmation,
} from '@/lib/sms/inbound'
import { sendTelnyxSmsMessage } from '@/lib/telnyx/sms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelnyxMessageEvent = {
  data: {
    id: string
    event_type: 'message.received' | 'message.sent' | 'message.finalized' | string
    occurred_at?: string
    payload: {
      id?: string
      text?: string
      from?: { phone_number?: string }
      to?: Array<{ phone_number?: string; status?: string }>
      errors?: Array<{ code?: string; title?: string; detail?: string }>
    }
  }
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  queued: 1,
  sent: 2,
  delivery_unconfirmed: 3,
  delivered: 4,
  delivery_failed: 4,
  failed: 4,
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  let event: TelnyxMessageEvent
  try {
    event = await unwrapTelnyxWebhook<TelnyxMessageEvent>(req, rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const admin = getAdminClient()
  const eventId = event.data?.id
  const eventType = event.data?.event_type
  if (!eventId || !eventType) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 })
  }
  const { error: claimError } = await admin.from('telephony_webhook_events').insert({
    provider: 'telnyx',
    provider_event_id: eventId,
    event_type: eventType,
    occurred_at: event.data.occurred_at ?? null,
    payload: event,
  })
  if (claimError?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })

  try {
    const payload = event.data.payload ?? {}
    const messageId = payload.id?.trim()
    if (!messageId) throw new Error('missing message id')

    if (eventType === 'message.received') {
      const from = payload.from?.phone_number?.trim()
      const to = payload.to?.[0]?.phone_number?.trim()
      const body = payload.text ?? ''
      if (!from || !to) throw new Error('missing sender or recipient')
      const result = await recordInboundSms({
        fromNumber: from,
        toNumber: to,
        body,
        providerMessageId: messageId,
        rawPayload: event as unknown as Record<string, unknown>,
        provider: 'telnyx',
      })
      if (!result.ok) throw new Error(result.error)
      if (!result.duplicate && isSmsOptOutMessage(body)) {
        await sendTelnyxSmsMessage({ to: from, body: smsOptOutConfirmation() })
      }
    } else if (eventType === 'message.sent' || eventType === 'message.finalized') {
      const status = payload.to?.[0]?.status?.trim() ||
        (eventType === 'message.sent' ? 'sent' : 'unknown')
      const { data: existing } = await admin
        .from('sms_messages')
        .select('status')
        .eq('provider_message_id', messageId)
        .maybeSingle()
      const currentRank = STATUS_RANK[existing?.status ?? 'pending'] ?? 0
      const nextRank = STATUS_RANK[status] ?? currentRank
      if (currentRank < 4 && nextRank >= currentRank) {
        const error = payload.errors?.map(item => item.detail || item.title || item.code).filter(Boolean).join('; ') || null
        const { error: updateError } = await admin
          .from('sms_messages')
          .update({ status, error, raw_payload: event })
          .eq('provider_message_id', messageId)
        if (updateError) throw new Error(updateError.message)
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    await admin.from('telephony_webhook_events')
      .delete()
      .eq('provider', 'telnyx')
      .eq('provider_event_id', eventId)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'processing failed' },
      { status: 500 },
    )
  }
}
