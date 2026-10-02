import 'server-only'

import { randomUUID } from 'node:crypto'
import { createActionProposal, executeActionProposal } from '@/lib/actions/server'
import type { ActionActor } from '@/lib/actions/types'

/** Committing is an explicit one-click acceptance of the current draft. */
export async function executeDailyPlanCommit(planId: string, actor: ActionActor) {
  const proposal = await createActionProposal({
    actionKey: 'daily_plan.commit',
    displaySummary: 'Commit the current daily plan',
    referencePayload: { planId },
    recordType: 'firm',
    source: 'today',
    idempotencyKey: `daily-plan-commit:${planId}:${randomUUID()}`,
  }, actor)
  return executeActionProposal(String(proposal.proposal.id), actor)
}
