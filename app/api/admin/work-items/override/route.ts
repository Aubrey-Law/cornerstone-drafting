import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import type { WorkState } from '@/lib/work/types'
import { invalidateWorkGraphCache } from '@/lib/work/requestCache'

const STATES: WorkState[] = ['open', 'blocked', 'waiting', 'snoozed']

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const workKey = typeof body?.workKey === 'string' ? body.workKey.trim() : ''
  const state = body?.state as WorkState
  if (workKey.length < 3 || workKey.length > 300 || !STATES.includes(state)) {
    return NextResponse.json({ error: 'A valid work item and state are required' }, { status: 400 })
  }
  const snoozedUntil = typeof body?.snoozedUntil === 'string' && !Number.isNaN(Date.parse(body.snoozedUntil))
    ? new Date(body.snoozedUntil).toISOString()
    : null
  if (state === 'snoozed' && !snoozedUntil) {
    return NextResponse.json({ error: 'Snoozed work needs a wake time' }, { status: 400 })
  }
  const assignedTo = typeof body?.assignedTo === 'string' && isUuid(body.assignedTo) ? body.assignedTo : null
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) || null : null
  const { data, error } = await getAdminClient().from('work_item_overrides').upsert({
    user_id: auth.userId,
    work_key: workKey,
    state,
    snoozed_until: state === 'snoozed' ? snoozedUntil : null,
    assigned_to: assignedTo,
    note,
  }, { onConflict: 'user_id,work_key' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateWorkGraphCache()
  return NextResponse.json({ override: data })
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workKey = new URL(req.url).searchParams.get('workKey')?.trim() ?? ''
  if (!workKey) return NextResponse.json({ error: 'workKey is required' }, { status: 400 })
  const { error } = await getAdminClient().from('work_item_overrides').delete()
    .eq('user_id', auth.userId).eq('work_key', workKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateWorkGraphCache()
  return new NextResponse(null, { status: 204 })
}
