import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => ({}))
  const {
    entity_id: entityId,
    stage_key: stageKey,
    snoozed_until: snoozedUntil,
    reason,
  } = body ?? {}

  const entity = body?.entity ?? 'matter'

  if (!entityId || !stageKey || !snoozedUntil) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (entity !== 'matter' && entity !== 'lead') {
    return NextResponse.json({ error: 'Invalid aging entity' }, { status: 400 })
  }

  const until = new Date(snoozedUntil)
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'snoozed_until must be in the future' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('pipeline_aging_snooze')
    .upsert(
      {
        entity,
        entity_id: String(entityId),
        stage_key: stageKey,
        snoozed_until: until.toISOString(),
        reason: typeof reason === 'string' ? reason.trim() || null : null,
        snoozed_by: auth.userId ?? null,
      },
      { onConflict: 'entity,entity_id,stage_key' },
    )
    .select('id, snoozed_until')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateSidebarCounts()
  return NextResponse.json({ ok: true, snooze: data })
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => ({}))
  const { snooze_id: snoozeId } = body ?? {}

  if (!snoozeId || typeof snoozeId !== 'number') {
    return NextResponse.json({ error: 'snooze_id required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { error } = await admin.from('pipeline_aging_snooze').delete().eq('id', snoozeId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}
