import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { STAGES, stageLabel, type MatterStage } from '@/types/database'
import { LIFECYCLE_REGISTRY_VERSION } from '@/lib/lifecycle/registry'
import { matterStageTransitionPreflight } from '@/lib/lifecycle/matter'
import { loadMatterLifecycleContext } from '@/lib/lifecycle/server'
import { schedulePlanStatusUpdate } from '@/lib/portal/delegatePlanStatus'
import { finishMatterClose } from '@/lib/fileClosing/server'

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
  const body = await req.json().catch(() => null) as {
    stage?: string
    confirmBlockers?: boolean
    lifecycleVersion?: string
    confirmedBlockerKeys?: string[]
  } | null
  const stage = body?.stage

  if (!stage || !VALID_STAGES.has(stage as MatterStage)) {
    return NextResponse.json({ error: 'A valid stage is required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const matterId = await resolveMatterId(rawId, admin).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    // Re-read every lifecycle source immediately before a consequential write.
    // A forward transition with blockers returns a preflight response and does
    // not mutate anything until the attorney confirms that exact registry
    // version. Backward corrections remain unblocked.
    const lifecycleContext = await loadMatterLifecycleContext(matterId)
    if (!lifecycleContext) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    const preflight = matterStageTransitionPreflight(
      lifecycleContext.matter,
      stage as MatterStage,
      lifecycleContext.engagement,
      lifecycleContext.reviewFlags,
    )
    if (preflight.requiresConfirmation && !body?.confirmBlockers) {
      return NextResponse.json({
        error: 'Review lifecycle blockers before changing stage.',
        requiresConfirmation: true,
        lifecycle: {
          version: preflight.version,
          fromStage: preflight.fromStage,
          targetStage: preflight.targetStage,
          blockers: preflight.blockers.map(({ key, label, owner, resolution, source }) => ({
            key, label, owner, resolution, source,
          })),
        },
      }, { status: 409 })
    }
    const currentBlockerKeys = preflight.blockers.map(blocker => blocker.key).sort()
    const confirmedBlockerKeys = Array.isArray(body?.confirmedBlockerKeys)
      ? [...new Set(body.confirmedBlockerKeys)].sort()
      : []
    if (preflight.requiresConfirmation && (
      body?.lifecycleVersion !== LIFECYCLE_REGISTRY_VERSION
      || JSON.stringify(confirmedBlockerKeys) !== JSON.stringify(currentBlockerKeys)
    )) {
      return NextResponse.json({
        error: 'Lifecycle requirements or record state changed. Review the blockers again.',
        requiresConfirmation: true,
        lifecycle: {
          version: preflight.version,
          fromStage: preflight.fromStage,
          targetStage: preflight.targetStage,
          blockers: preflight.blockers.map(({ key, label, owner, resolution, source }) => ({
            key, label, owner, resolution, source,
          })),
        },
      }, { status: 409 })
    }

    const actorName =
      (user?.user_metadata?.full_name as string | undefined)
      ?? user?.email
      ?? null

    // Closing is one move on both axes. The status transition runs first
    // because it carries the billing check: a matter with a balance, an open
    // claim or a ready milestone is refused here (409) before the stage moves,
    // instead of landing at `closed` with its status still `active` and the
    // check never run. Leaving `closed` by stage reopens the status too.
    if (stage === 'closed') {
      const { error: statusError } = await admin.rpc('transition_matter_status_with_closeout', {
        p_matter_id: matterId,
        p_status: 'closed',
        p_hold_reason: null,
        p_status_label: 'Closed',
        p_actor_id: userId,
        p_actor_email: user?.email ?? null,
        p_actor_name: actorName,
      })
      if (statusError) {
        if (statusError.code === 'P0002') return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
        if (statusError.code === 'P0001') return NextResponse.json({ error: statusError.message }, { status: 409 })
        throw new Error(statusError.message)
      }
    }

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
        // The closed date, the retention date, and the client's closing notice
        // through the dial. Never fails the close: it has already committed.
        await finishMatterClose(admin, { matterId, actor })
      } else if (result.previousStage === 'closed') {
        // Scoped to this sweep's own rows: a lead's held-back plan and a
        // hand-skipped task carry their own markers and are not this to revive.
        await restoreTasksForReopenedRecord(admin, { matterId }, actor, { reasons: ['matter_closed'] })
        const { error: reopenError } = await admin.rpc('transition_matter_status_with_closeout', {
          p_matter_id: matterId,
          p_status: 'active',
          p_hold_reason: null,
          p_status_label: 'Active',
          p_actor_id: userId,
          p_actor_email: user?.email ?? null,
          p_actor_name: actorName,
        })
        if (reopenError) console.error('[stage] could not reopen matter status:', reopenError.message)
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
    // A stage the client would notice is a moment to tell them where things
    // stand; the dial decides whether the update waits for a click or goes.
    if (!result.unchanged && stage !== 'closed') {
      schedulePlanStatusUpdate({ matterId, actorId: userId })
    }
    return NextResponse.json({
      ...result,
      lifecycle: {
        version: LIFECYCLE_REGISTRY_VERSION,
        confirmedWithBlockers: preflight.requiresConfirmation,
        blockers: preflight.blockers.map(({ key, label, owner, resolution, source }) => ({
          key, label, owner, resolution, source,
        })),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update stage'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
