import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { unwrapTelnyxWebhook } from '@/lib/telnyx/client'
import { telnyxVoiceEventToRow, type TelnyxVoiceEvent } from '@/lib/telnyx/voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const rawBody = await req.text()
  let event: TelnyxVoiceEvent
  try {
    event = await unwrapTelnyxWebhook<TelnyxVoiceEvent>(req, rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { error: claimError } = await admin.from('telephony_webhook_events').insert({
    provider: 'telnyx',
    provider_event_id: event.data.id,
    event_type: event.data.event_type,
    occurred_at: event.data.occurred_at ?? null,
    payload: event,
  })
  if (claimError?.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })

  try {
    if (event.data.event_type === 'call.recording.saved') {
      const payload = event.data.payload
      const callId = String(payload.call_control_id ?? payload.call_leg_id ?? '')
      const urls = payload.recording_urls as Record<string, unknown> | undefined
      const recordingUrl = typeof urls?.mp3 === 'string'
        ? urls.mp3
        : typeof urls?.wav === 'string'
          ? urls.wav
          : null
      if (callId && recordingUrl) {
        const { error } = await admin.from('calls')
          .update({ recording_url: recordingUrl, raw_payload: event })
          .eq('external_call_id', callId)
        if (error) throw error
      }
    } else {
      const incoming = telnyxVoiceEventToRow(event)
      if (incoming) {
        const { data: existing } = await admin
          .from('calls')
          .select('*')
          .eq('external_call_id', incoming.external_call_id)
          .maybeSingle()
        const row = {
          ...(existing ?? {}),
          ...incoming,
          answered_at: incoming.answered_at ?? existing?.answered_at ?? null,
          ended_at: incoming.ended_at ?? existing?.ended_at ?? null,
          duration_seconds: incoming.duration_seconds ?? existing?.duration_seconds ?? null,
          status: incoming.status === 'unknown' ? existing?.status ?? 'initiated' : incoming.status,
        }
        const { error } = await admin.from('calls').upsert(row, { onConflict: 'external_call_id' })
        if (error) throw error
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    await admin.from('telephony_webhook_events')
      .delete()
      .eq('provider', 'telnyx')
      .eq('provider_event_id', event.data.id)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'processing failed' },
      { status: 500 },
    )
  }
}
