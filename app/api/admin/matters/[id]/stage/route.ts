import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { STAGES, stageLabel, type MatterStage } from '@/types/database'

import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'

type Params = { params: Promise<{ id: string }> }

const VALID_STAGES = new Set<MatterStage>(STAGES.map(s => s.key))

export async function PATCH(req: Request, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const { id: rawId } = await params
  const body = await req.json().catch(() => null) as { stage?: string } | null
  const stage = body?.stage

  if (!stage || !VALID_STAGES.has(stage as MatterStage)) {
    return NextResponse.json({ error: 'A valid stage is required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const matterId = await resolveMatterId(rawId, admin)

    const { data: existing, error: fetchError } = await admin
      .from('matters')
      .select('id, stage')
      .eq('id', matterId)
      .maybeSingle()

    if (fetchError) throw new Error(fetchError.message)
    if (!existing) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const previousStage = existing.stage as MatterStage
    if (previousStage === stage) {
      return NextResponse.json({ matterId, stage, unchanged: true })
    }

    const { error: updateError } = await admin
      .from('matters')
      .update({ stage })
      .eq('id', matterId)

    if (updateError) throw new Error(updateError.message)

    const actorName =
      (user?.user_metadata?.full_name as string | undefined)
      ?? user?.email
      ?? null

    await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'stage_changed',
      title: `Stage changed to ${stageLabel(stage as MatterStage)}`,
      detail: previousStage
        ? `From ${stageLabel(previousStage)} to ${stageLabel(stage as MatterStage)}`
        : null,
      metadata: { from: previousStage, to: stage },
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: actorName,
    })

    try {
      await fireEngineStageTask(admin, { matterId, matterStage: stage })
    } catch (fireErr) {
      console.error('[stage] fireEngineStageTask failed:', fireErr)
    }

    return NextResponse.json({ matterId, stage, previousStage })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update stage'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
