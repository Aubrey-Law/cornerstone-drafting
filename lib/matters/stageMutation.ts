import type { SupabaseClient } from '@supabase/supabase-js'
import { stageLabel, type MatterStage } from '@/types/database'
import { LIFECYCLE_REGISTRY_VERSION } from '@/lib/lifecycle/registry'
import { matterStageTransitionPreflight } from '@/lib/lifecycle/matter'
import { loadMatterLifecycleContext } from '@/lib/lifecycle/server'
import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import { archiveTasksForClosedRecord, restoreTasksForReopenedRecord } from '@/lib/tasks/closeout'
import type { ActionActor } from '@/lib/actions/types'

export async function previewMatterStageTransition(matterId: string, targetStage: MatterStage) {
  const lifecycleContext = await loadMatterLifecycleContext(matterId)
  if (!lifecycleContext) throw new Error('Matter not found')
  const preflight = matterStageTransitionPreflight(
    lifecycleContext.matter,
    targetStage,
    lifecycleContext.engagement,
    lifecycleContext.reviewFlags,
  )
  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    fromStage: preflight.fromStage,
    targetStage: preflight.targetStage,
    requiresConfirmation: preflight.requiresConfirmation,
    blockers: preflight.blockers.map(({ key, label, owner, resolution, source }) => ({
      key, label, owner, resolution, source,
    })),
  }
}

/** Shared consequential stage write for record pages, the action registry, and automations. */
export async function transitionMatterStage(
  admin: SupabaseClient,
  input: { matterId: string; stage: MatterStage; actor: ActionActor },
) {
  // Re-read lifecycle sources in the executor as a final defense. The action
  // service also compares the preview digest before it reserves the execution.
  const lifecycle = await previewMatterStageTransition(input.matterId, input.stage)
  const actorName = (input.actor.user_metadata?.full_name as string | undefined) ?? input.actor.email ?? null
  const { data, error } = await admin.rpc('transition_matter_stage_with_jobs', {
    p_matter_id: input.matterId,
    p_stage: input.stage,
    p_stage_label: stageLabel(input.stage),
    p_actor_id: input.actor.id,
    p_actor_email: input.actor.email ?? null,
    p_actor_name: actorName,
  })
  if (error) throw new Error(error.code === 'P0002' ? 'Matter not found' : error.message)

  const result = data as {
    matterId: string
    stage: MatterStage
    previousStage: MatterStage
    unchanged: boolean
    durableJobs: boolean
  }
  if (!result.unchanged) {
    const taskActor = { id: input.actor.id, email: input.actor.email ?? null, name: actorName }
    if (input.stage === 'closed') {
      await archiveTasksForClosedRecord(admin, { matterId: input.matterId }, 'matter_closed', taskActor)
    } else if (result.previousStage === 'closed') {
      await restoreTasksForReopenedRecord(admin, { matterId: input.matterId }, taskActor, { reasons: ['matter_closed'] })
    }
  }
  if (!result.unchanged && !result.durableJobs) {
    try {
      await fireEngineStageTask(admin, { matterId: input.matterId, matterStage: input.stage })
    } catch (error) {
      console.error('[stage-action] fireEngineStageTask failed', error)
    }
  }
  // The same moment the stage route uses to offer the client an update.
  if (!result.unchanged && input.stage !== 'closed') {
    const { schedulePlanStatusUpdate } = await import('@/lib/portal/delegatePlanStatus')
    schedulePlanStatusUpdate({ matterId: input.matterId, actorId: input.actor.id })
  }
  return { ...result, lifecycle }
}
