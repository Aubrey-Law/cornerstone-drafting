import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  RETELL_UPSERT_EVENTS,
  retellWebhookToRow,
  type RetellCallRowInsert,
} from '@/lib/retell/normalize'
import { notifyRetellCallAnalyzed, retellRowToNotifyInput } from '@/lib/retell/notify'
import { runReceptionistFollowUp } from '@/lib/retell/followUp'
import type { RetellWebhookPayload } from '@/lib/retell/types'
import { verifyRetellSignature } from '@/lib/retell/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ExistingCall = RetellCallRowInsert & {
  id?: string
  matter_id?: string | null
}

// The former mergeCallRow() lived here. It is now public.upsert_retell_call in
// migration 20260814000001 — merging in SQL is what makes concurrent events safe.

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

  // Merge column-wise inside ON CONFLICT rather than read-modify-write here.
  // Two events for the same call (call_ended + call_analyzed, or a provider
  // retry racing itself) both used to read the same pre-write row, so whichever
  // wrote last reinstated the other's fields as null — losing the recording of a
  // client intake call. The RPC evaluates COALESCE against the current row under
  // the conflict's row lock, so neither event can clobber the other.
  const { data, error } = await admin.rpc('upsert_retell_call', { p_call: row })

  if (error) {
    console.error('[retell] upsert error', { callId: row.external_call_id, error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { previous_summary: string | null; conflict: boolean }
    | undefined

  if (!result) {
    return NextResponse.json({ error: 'call upsert returned no row' }, { status: 500 })
  }

  if (result.conflict) {
    console.error('[retell] external_call_id owned by another provider', {
      callId: row.external_call_id,
    })
    return NextResponse.json({ error: 'call id conflict' }, { status: 409 })
  }

  if (payload.event === 'call_analyzed') {
    // Read back the merged row so the notification sees the same complete state
    // the database now holds (e.g. a recording_url that arrived on call_ended).
    const { data: mergedRow } = await admin
      .from('calls')
      .select(
        'external_call_id, provider, direction, status, from_number, to_number, participant_number, firm_user_id, firm_user_email, started_at, answered_at, ended_at, duration_seconds, recording_url, voicemail_url, transcript, summary, raw_payload, matter_id',
      )
      .eq('external_call_id', row.external_call_id)
      .maybeSingle()

    const merged = (mergedRow as ExistingCall | null) ?? row
    await notifyRetellCallAnalyzed(
      retellRowToNotifyInput(merged),
      { previousSummary: result.previous_summary ?? null },
    )

    // The receptionist's follow-up: match the caller, then hand the next
    // steps (callback task, new lead, booked call, scheduling link) to the
    // delegation dial. Only once per analysed summary, and never allowed to
    // fail the webhook: Retell would retry, and the summary email already
    // went out.
    if (result.previous_summary?.trim() !== merged.summary?.trim()) {
      try {
        await runReceptionistFollowUp({ call: { ...merged, matter_id: (merged as ExistingCall).matter_id ?? null } })
      } catch (error) {
        console.error('[retell] receptionist follow-up failed', {
          callId: row.external_call_id,
          cause: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
