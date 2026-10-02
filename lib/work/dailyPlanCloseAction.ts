import 'server-only'

import { randomUUID } from 'node:crypto'
import { createActionProposal, executeActionProposal } from '@/lib/actions/server'
import type { ActionActor } from '@/lib/actions/types'

/** Closing preserves source work and its deadlines; it only seals the plan. */
export async function executeDailyPlanClose(planId: string, actor: ActionActor) {
  const proposal = await createActionProposal({
    actionKey: 'daily_plan.close',
    displaySummary: 'Close today’s plan after reviewing unfinished work',
    referencePayload: { planId },
    recordType: 'firm',
    source: 'today',
    idempotencyKey: `daily-plan-close:${planId}:${randomUUID()}`,
  }, actor)
  return executeActionProposal(String(proposal.proposal.id), actor)
}
