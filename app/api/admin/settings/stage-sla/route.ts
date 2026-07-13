import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchStageSlaRows } from '@/lib/queries/pipelineAging'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const rows = await fetchStageSlaRows()
  return NextResponse.json({ rows })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => ({}))
  const {
    stage_key: stageKey,
    track = 'DEFAULT',
    entity = 'matter',
    sla_days: slaDays,
    escalation_offset: escalationOffset,
  } = body ?? {}

  if (!stageKey || !track || (entity !== 'matter' && entity !== 'lead')) {
    return NextResponse.json({ error: 'Valid stage_key, track, and entity required' }, { status: 400 })
  }

  const patch: Record<string, number | null> = {}
  if ('sla_days' in body) {
    if (slaDays !== null && (typeof slaDays !== 'number' || slaDays < 0)) {
      return NextResponse.json({ error: 'sla_days must be null or a non-negative number' }, { status: 400 })
    }
    patch.sla_days = slaDays
  }
  if ('escalation_offset' in body) {
    if (escalationOffset !== null && (typeof escalationOffset !== 'number' || escalationOffset < 0)) {
      return NextResponse.json(
        { error: 'escalation_offset must be null or a non-negative number' },
        { status: 400 },
      )
    }
    patch.escalation_offset = escalationOffset
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error: updateError } = await admin
    .from('stage_sla')
    .update(patch)
    .eq('stage_key', stageKey)
    .eq('track', track)
    .eq('entity', entity)
    .select('stage_key, track, entity, owner, sla_days, escalation_offset, stage_order')
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

  return NextResponse.json({ row: data })
}
