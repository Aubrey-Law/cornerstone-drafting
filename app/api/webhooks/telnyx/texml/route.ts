import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { verifyTelnyxWebhookRequest } from '@/lib/telnyx/client'
import {
  mergeTelnyxCallRows,
  parseTelnyxTexmlStatusCallback,
  telnyxTexmlStatusToRow,
} from '@/lib/telnyx/voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return NextResponse.json({ error: 'unsupported content type' }, { status: 415 })
  }

  const rawBody = await req.text()
  try {
    verifyTelnyxWebhookRequest(req, rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const callback = parseTelnyxTexmlStatusCallback(rawBody)
  if (!callback) {
    return NextResponse.json({ error: 'invalid TeXML status callback' }, { status: 400 })
  }

  const admin = getAdminClient()
  const providerEventId = `texml:${callback.CallSid}:${callback.SequenceNumber}`
  const eventType = `texml.call.${callback.CallStatus}`
  const occurredAt = callback.OccurredAt || callback.Timestamp || null
  const { error: claimError } = await admin.from('telephony_webhook_events').insert({
    provider: 'telnyx',
    provider_event_id: providerEventId,
    event_type: eventType,
    occurred_at: occurredAt,
    payload: callback,
  })
  if (claimError?.code === '23505') {
    return NextResponse.json({ ok: true, duplicate: true })
  }
  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }

  try {
    const incoming = telnyxTexmlStatusToRow(callback)
    const { data: existing } = await admin
      .from('calls')
      .select('*')
      .eq('external_call_id', incoming.external_call_id)
      .maybeSingle()
    const row = mergeTelnyxCallRows(existing, incoming)
    const { error } = await admin.from('calls').upsert(row, { onConflict: 'external_call_id' })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    await admin.from('telephony_webhook_events')
      .delete()
      .eq('provider', 'telnyx')
      .eq('provider_event_id', providerEventId)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'processing failed' },
      { status: 500 },
    )
  }
}
