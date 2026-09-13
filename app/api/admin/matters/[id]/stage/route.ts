import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { STAGES, stageLabel, type MatterStage } from '@/types/database'

import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import {
  archiveTasksForClosedRecord,
  restoreTasksForReopenedRecord,
} from '@/lib/tasks/closeout'

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
    const matterId = await resolveMatterId(rawId, admin).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    const actorName =
      (user?.user_metadata?.full_name as string | undefined)
      ?? user?.email
      ?? null
    const { data, error } = await admin.rpc('transition_matter_stage_with_jobs', {
      p_matter_id: matterId,
      p_stage: stage,
      p_stage_label: stageLabel(stage as MatterStage),
      p_actor_id: userId,
      p_actor_email: user?.email ?? null,
      p_actor_name: actorName,
    })
    if (error) {
      if (error.code === 'P0002') return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
      throw new Error(error.message)
    }

    const result = data as {
      matterId: string
      stage: MatterStage
      previousStage: MatterStage
      unchanged: boolean
      durableJobs: boolean
    }
    // Closing a matter is a stage move here: the Close-out card stamps the date
    // and sets the stage in one action, and nothing else ran afterwards — so a
    // closed matter kept its whole unfinished checklist in the firm queue. The
    // same sweep the status route runs, for the same reason, and reversible the
    // same way: reopening the matter puts back exactly what this archived.
    if (!result.unchanged) {
      const actor = { id: userId, email: user?.email ?? null, name: actorName }
      if (stage === 'closed') {
        await archiveTasksForClosedRecord(admin, { matterId }, 'matter_closed', actor)
      } else if (result.previousStage === 'closed') {
        // Scoped to this sweep's own rows: a lead's held-back plan and a
        // hand-skipped task carry their own markers and are not this to revive.
        await restoreTasksForReopenedRecord(admin, { matterId }, actor, { reasons: ['matter_closed'] })
      }
    }

    // Feature-flag fallback preserves current behavior until durable processing
    // is explicitly enabled in firm settings.
    if (!result.unchanged && !result.durableJobs) {
      try {
        await fireEngineStageTask(admin, { matterId, matterStage: stage })
      } catch (fireErr) {
        console.error('[stage] fireEngineStageTask failed:', fireErr)
      }
    }
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update stage'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
