import 'server-only'

import { randomUUID } from 'node:crypto'
import { createActionProposal, executeActionProposal } from '@/lib/actions/server'
import type { ActionActor } from '@/lib/actions/types'
import type { DailyPlanCalendarSyncResult } from '@/lib/work/dailyPlanCalendar'

/** Commit/Sync is the user's one-click acceptance of this internal write. */
export async function executeDailyPlanCalendarSync(planId: string, actor: ActionActor) {
  const proposal = await createActionProposal({
    actionKey: 'daily_plan.calendar.sync',
    displaySummary: 'Reserve the committed daily plan on the internal calendar',
    referencePayload: { planId },
    recordType: 'firm',
    source: 'today',
    // Each reconciliation attempt is audited separately. Appointment rows and
    // deterministic Google event ids make the actual effects idempotent.
    idempotencyKey: `daily-plan-calendar-sync:${planId}:${randomUUID()}`,
  }, actor)
  const executed = await executeActionProposal(String(proposal.proposal.id), actor)
  return executed.result as DailyPlanCalendarSyncResult
}
