import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { parseTwilioForm } from '@/lib/twilio/form'
import { twilioStatusToRow, type TwilioCallRowInsert } from '@/lib/twilio/normalize'
import { verifyTwilioRequest } from '@/lib/twilio/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExistingCall = TwilioCallRowInsert & {
  id?: string
}

function mergeCallRow(existing: ExistingCall | null, incoming: TwilioCallRowInsert): TwilioCallRowInsert {
  if (!existing) return incoming

  return {
    ...incoming,
    firm_user_email: incoming.firm_user_email ?? existing.firm_user_email,
    answered_at: incoming.answered_at ?? existing.answered_at,
    ended_at: incoming.ended_at ?? existing.ended_at,
    duration_seconds: incoming.duration_seconds ?? existing.duration_seconds,
    recording_url: incoming.recording_url ?? existing.recording_url,
    voicemail_url: incoming.voicemail_url ?? existing.voicemail_url,
    transcript: incoming.transcript ?? existing.transcript,
    summary: incoming.summary ?? existing.summary,
    started_at: existing.started_at || incoming.started_at,
    raw_payload: {
      ...(typeof existing.raw_payload === 'object' && existing.raw_payload ? existing.raw_payload : {}),
      ...incoming.raw_payload,
    },
  }
}

export async function POST(req: Request) {
  const params = await parseTwilioForm(req)

  if (!verifyTwilioRequest(req, params)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const row = twilioStatusToRow(params)
  if (!row) {
    return NextResponse.json({ error: 'missing CallSid' }, { status: 400 })
  }

  const admin = getAdminClient()

  if (row.firm_user_id && !row.firm_user_email) {
    const { data: user } = await admin
      .from('users')
      .select('email')
      .eq('id', row.firm_user_id)
      .maybeSingle()
    row.firm_user_email = user?.email ?? null
  }

  const { data: existing } = await admin
    .from('calls')
    .select(
      'external_call_id, provider, direction, status, from_number, to_number, participant_number, firm_user_id, firm_user_email, started_at, answered_at, ended_at, duration_seconds, recording_url, voicemail_url, transcript, summary, raw_payload',
    )
    .eq('external_call_id', row.external_call_id)
    .maybeSingle()

  const merged = mergeCallRow(existing as ExistingCall | null, row)

  const { error } = await admin.from('calls').upsert(merged, { onConflict: 'external_call_id' })
  if (error) {
    console.error('[twilio/voice-status] upsert error', { callSid: row.external_call_id, error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
