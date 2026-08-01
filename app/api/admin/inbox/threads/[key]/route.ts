import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { consumeRateLimit } from '@/lib/rateLimit'
import { fetchThreadItems, parseThreadKey } from '@/lib/queries/inbox'

type Params = { params: Promise<{ key: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { key: rawKey } = await params
  const key = parseThreadKey(decodeURIComponent(rawKey))
  if (!key) return NextResponse.json({ error: 'Invalid thread key' }, { status: 400 })

  try {
    const items = await fetchThreadItems(key)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('[inbox] thread items error:', error)
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 })
  }
}

interface TriagePatch {
  read?: boolean
  snoozed_until?: string | null
  archived?: boolean
  assigned_to?: string | null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const rate = await consumeRateLimit(
    { bucket: 'inbox_triage', limit: 120, windowSeconds: 60 },
    userId ?? 'anonymous',
  )
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  const { key: rawKey } = await params
  const threadKey = decodeURIComponent(rawKey)
  const key = parseThreadKey(threadKey)
  if (!key) return NextResponse.json({ error: 'Invalid thread key' }, { status: 400 })

  let body: TriagePatch
  try {
    body = await req.json() as TriagePatch
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.snoozed_until != null && Number.isNaN(Date.parse(body.snoozed_until))) {
    return NextResponse.json({ error: 'snoozed_until must be an ISO timestamp' }, { status: 400 })
  }

  const admin = getAdminClient()
  const nowIso = new Date().toISOString()

  // Read markers live on the source tables; the state row only carries the
  // manual unread flag on top of them.
  if (body.read === true) {
    if (key.recordType === 'matter') {
      const [portal, sms] = await Promise.all([
        admin
          .from('messages')
          .update({ read_at: nowIso })
          .eq('matter_id', key.recordId)
          .eq('sender_role', 'client')
          .is('read_at', null),
        admin
          .from('sms_messages')
          .update({ read_by_staff_at: nowIso })
          .eq('matter_id', key.recordId)
          .eq('direction', 'inbound')
          .is('read_by_staff_at', null),
      ])
      const failure = portal.error ?? sms.error
      if (failure) return NextResponse.json({ error: failure.message }, { status: 500 })
    } else {
      const { error } = await admin
        .from('sms_messages')
        .update({ read_by_staff_at: nowIso })
        .eq('lead_id', key.recordId)
        .eq('direction', 'inbound')
        .is('read_by_staff_at', null)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const statePatch: Record<string, unknown> = {
    thread_key: threadKey,
    updated_by: userId,
  }
  if (body.read === true) statePatch.marked_unread_at = null
  if (body.read === false) statePatch.marked_unread_at = nowIso
  if ('snoozed_until' in body) statePatch.snoozed_until = body.snoozed_until
  if ('archived' in body) statePatch.archived_at = body.archived ? nowIso : null
  if ('assigned_to' in body) statePatch.assigned_to = body.assigned_to

  const { data, error } = await admin
    .from('communication_thread_state')
    .upsert(statePatch, { onConflict: 'thread_key' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data })
}
