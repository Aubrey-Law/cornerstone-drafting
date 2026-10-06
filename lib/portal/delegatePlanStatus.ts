import 'server-only'

import { after } from 'next/server'
import { planStatusDigest } from '@/lib/portal/planStatus'

/**
 * Offer the client a "where your plan stands" update through the delegation
 * dial when a matter changes stage.
 *
 * The update is drafted from the record and proposed as
 * `portal.status.publish`: at Propose it waits as a card on Today for the
 * attorney to read and approve; at Act and report it goes to the client's
 * portal at once and is listed in the digest. Keyed to the matter and a
 * fingerprint of what it would say, so a stage change that tells the client
 * nothing new is not offered twice.
 */
export async function delegatePlanStatusUpdate(input: {
  matterId: string
  /** The staff member whose change prompted it, else the firm's unattended actor. */
  actorId?: string | null
}): Promise<'proposed' | 'done' | 'observed' | 'skipped' | 'failed'> {
  try {
    const { loadPlanStatusFacts, draftPlanStatus } = await import('@/lib/portal/planStatusServer')
    const loaded = await loadPlanStatusFacts(input.matterId)
    if (!loaded) return 'skipped'
    if (loaded.matter.status === 'archived') return 'skipped'

    const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
    const actor = input.actorId ? { id: input.actorId } : await resolveUnattendedActor()
    if (!actor) return 'skipped'

    const draft = await draftPlanStatus({ facts: loaded.facts, matterId: input.matterId, actorId: actor.id })
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: 'portal.status.publish',
      displaySummary: `Tell the client where their plan stands (${loaded.facts.stageLabel})`,
      referencePayload: {
        matterId: input.matterId,
        stage: loaded.matter.stage,
        body: draft.body,
        facts: {
          stage: loaded.facts.stage,
          milestones: loaded.facts.milestones,
          nextAppointment: loaded.facts.nextAppointment,
          funding: loaded.facts.funding,
          clientFollowUp: loaded.facts.clientFollowUp,
          draftedBy: draft.model,
        },
      },
      recordType: 'matter',
      recordId: input.matterId,
      source: 'automation',
      idempotencyKey: `plan-status:${input.matterId}:${planStatusDigest(loaded.facts)}`,
      applyAutonomy: true,
    }, actor)
    if (created.duplicate) return 'skipped'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'done' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[portal] plan status delegation failed', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}

/**
 * Queue the update behind the response that changed the stage, so the stage
 * write stays quick and nothing here can fail it.
 */
export function schedulePlanStatusUpdate(input: { matterId: string; actorId?: string | null }): void {
  const run = async () => {
    await delegatePlanStatusUpdate(input)
  }
  try {
    after(run)
  } catch {
    // Outside a request scope (tests, scripts) there is no "after"; run inline.
    void run()
  }
}
