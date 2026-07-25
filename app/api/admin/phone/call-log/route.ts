import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { voiceProvider } from '@/lib/communications/providers'
import { formatPhoneDisplay } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTCOME_STATUS: Record<string, string> = {
  Reached: 'completed',
  Voicemail: 'voicemail',
  'No answer': 'no-answer',
}

/** Webhook rows can land a second or two after the browser posts the wrap-up. */
const MATCH_WINDOW_MINUTES = 15

interface Body {
  externalCallId?: string | null
  participantNumber?: string
  direction?: 'inbound' | 'outbound'
  durationSeconds?: number
  outcome?: string
  notes?: string | null
  matterId?: string | null
  leadId?: string | null
}

/**
 * POST /api/admin/phone/call-log
 *
 * Persists the softphone wrap-up: outcome, notes, and the matter or lead the
 * call belongs to. Attaches to the row the provider webhook already created
 * when it can (by external id, else the most recent matching call), and
 * inserts a row when the webhook hasn't arrived or isn't configured.
 */
export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const digits = (body.participantNumber ?? '').replace(/\D/g, '').slice(-10)
  if (!digits) return NextResponse.json({ error: 'A participant number is required' }, { status: 400 })

  const direction = body.direction === 'inbound' ? 'inbound' : 'outbound'
  const status = OUTCOME_STATUS[body.outcome ?? ''] ?? 'completed'
  const durationSeconds =
    typeof body.durationSeconds === 'number' && body.durationSeconds >= 0
      ? Math.round(body.durationSeconds)
      : null
  const summary = body.notes?.trim()
    ? `${body.outcome ?? 'Reached'} — ${body.notes.trim()}`
    : (body.outcome ?? 'Reached')

  const admin = getAdminClient()

  // 1. the row the webhook created for this exact call
  let existingId: string | null = null
  if (body.externalCallId) {
    const { data } = await admin
      .from('calls')
      .select('id')
      .eq('external_call_id', body.externalCallId)
      .maybeSingle()
    existingId = (data?.id as string | undefined) ?? null
  }

  // 2. otherwise the most recent call with this participant
  if (!existingId) {
    const since = new Date(Date.now() - MATCH_WINDOW_MINUTES * 60_000).toISOString()
    const { data } = await admin
      .from('calls')
      .select('id')
      .eq('participant_digits', digits)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    existingId = (data?.id as string | undefined) ?? null
  }

  // calls_single_record_link: a call links to a matter OR a lead, never both.
  const matterId = body.matterId ?? null
  const leadId = matterId ? null : (body.leadId ?? null)

  if (existingId) {
    const patch: Record<string, unknown> = { status, summary, direction }
    // don't overwrite a webhook-reported duration or auto-assigned links with nulls
    if (durationSeconds !== null) patch.duration_seconds = durationSeconds
    if (matterId) {
      patch.matter_id = matterId
      patch.lead_id = null
    } else if (leadId) {
      patch.lead_id = leadId
      patch.matter_id = null
    }
    const { error } = await admin.from('calls').update(patch).eq('id', existingId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, callId: existingId, mode: 'updated' })
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('calls')
    .insert({
      status,
      summary,
      direction,
      matter_id: matterId,
      lead_id: leadId,
      duration_seconds: durationSeconds,
      participant_number: formatPhoneDisplay(body.participantNumber ?? '') || body.participantNumber || digits,
      provider: voiceProvider(),
      external_call_id: body.externalCallId || `softphone:${userId}:${Date.now()}`,
      firm_user_id: userId,
      firm_user_email: user?.email ?? null,
      started_at: durationSeconds ? new Date(Date.now() - durationSeconds * 1000).toISOString() : nowIso,
      answered_at: status === 'completed' ? nowIso : null,
      ended_at: nowIso,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, callId: data.id, mode: 'inserted' })
}
