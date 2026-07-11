import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  RETELL_UPSERT_EVENTS,
  retellWebhookToRow,
  type RetellCallRowInsert,
} from '@/lib/retell/normalize'
import { notifyRetellCallAnalyzed, retellRowToNotifyInput } from '@/lib/retell/notify'
import type { RetellWebhookPayload } from '@/lib/retell/types'
import { verifyRetellSignature } from '@/lib/retell/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExistingCall = RetellCallRowInsert & {
  id?: string
  matter_id?: string | null
}

function mergeCallRow(
  existing: ExistingCall | null,
  incoming: RetellCallRowInsert,
): RetellCallRowInsert {
  if (!existing) return incoming

  return {
    ...incoming,
    firm_user_email: incoming.firm_user_email ?? existing.firm_user_email,
    firm_user_id: incoming.firm_user_id ?? existing.firm_user_id,
    answered_at: incoming.answered_at ?? existing.answered_at,
    ended_at: incoming.ended_at ?? existing.ended_at,
    duration_seconds: incoming.duration_seconds ?? existing.duration_seconds,
    recording_url: incoming.recording_url ?? existing.recording_url,
    voicemail_url: incoming.voicemail_url ?? existing.voicemail_url,
    transcript: incoming.transcript ?? existing.transcript,
    summary: incoming.summary ?? existing.summary,
    started_at: existing.started_at || incoming.started_at,
    raw_payload: {
      ...(typeof existing.raw_payload === 'object' && existing.raw_payload
        ? existing.raw_payload
        : {}),
      ...incoming.raw_payload,
    },
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.RETELL_API_KEY?.trim()
  if (!apiKey) {
    console.error('[retell] missing RETELL_API_KEY')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-retell-signature')
  if (!verifyRetellSignature(rawBody, apiKey, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: RetellWebhookPayload
  try {
    payload = JSON.parse(rawBody) as RetellWebhookPayload
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!payload?.event) {
    return NextResponse.json({ error: 'missing event' }, { status: 400 })
  }

  if (!RETELL_UPSERT_EVENTS.has(payload.event)) {
    return NextResponse.json({ ok: true, ignored: payload.event })
  }

  const row = retellWebhookToRow(payload)
  if (!row) {
    return NextResponse.json({ error: 'missing call_id' }, { status: 400 })
  }

  const admin = getAdminClient()

  const { data: existing } = await admin
    .from('calls')
    .select(
      'external_call_id, provider, direction, status, from_number, to_number, participant_number, firm_user_id, firm_user_email, started_at, answered_at, ended_at, duration_seconds, recording_url, voicemail_url, transcript, summary, raw_payload, matter_id',
    )
    .eq('external_call_id', row.external_call_id)
    .maybeSingle()

  if (existing && existing.provider && existing.provider !== 'retell') {
    console.error('[retell] external_call_id owned by another provider', {
      callId: row.external_call_id,
      provider: existing.provider,
    })
    return NextResponse.json({ error: 'call id conflict' }, { status: 409 })
  }

  const existingRow = existing as ExistingCall | null
  const merged = mergeCallRow(existingRow, row)

  const { error } = await admin.from('calls').upsert(merged, { onConflict: 'external_call_id' })
  if (error) {
    console.error('[retell] upsert error', { callId: row.external_call_id, error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (payload.event === 'call_analyzed') {
    await notifyRetellCallAnalyzed(
      retellRowToNotifyInput({
        ...merged,
        matter_id: existingRow?.matter_id ?? null,
      }),
      { previousSummary: existingRow?.summary ?? null },
    )
  }

  return NextResponse.json({ ok: true })
}
