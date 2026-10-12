import type { WorkItem } from '@/lib/work/types'

export type CommandCenterDoneAction = {
  actionKey: string
  referencePayload: Record<string, unknown>
  displaySummary: string
  /** When true, completion only clears the personal plan row via override. */
  planOnly?: boolean
}

/**
 * Map a Command Center work card to an auditable Done action. Returns null when
 * Done would lie about source state (billing balances, stage transitions).
 */
export function resolveCommandCenterDone(item: WorkItem): CommandCenterDoneAction | null {
  switch (item.sourceType) {
    case 'task':
      return {
        actionKey: 'task.complete',
        referencePayload: { taskId: item.sourceIds[0] },
        displaySummary: `Complete task: ${item.title}`,
      }
    case 'portal_message':
      return {
        actionKey: 'portal.messages.mark_read',
        referencePayload: { matterId: item.sourceIds[0] },
        displaySummary: `Mark portal messages read: ${item.record.name}`,
      }
    case 'sms':
      return {
        actionKey: 'sms.thread.mark_read',
        referencePayload: { phone: item.sourceIds[0] },
        displaySummary: `Mark texts read: ${item.record.name}`,
      }
    case 'email':
      return {
        actionKey: 'email.triage.dismiss',
        referencePayload: { threadId: item.sourceIds[0], scope: 'thread' },
        displaySummary: `Dismiss email triage: ${item.title}`,
      }
    case 'document_review':
      return {
        actionKey: 'matter.uploads.mark_reviewed',
        referencePayload: { matterId: item.sourceIds[0] },
        displaySummary: `Mark uploads reviewed: ${item.record.name}`,
      }
    case 'appointment_prep':
      return {
        actionKey: 'work.override',
        referencePayload: {
          workKey: item.workKey,
          state: 'snoozed',
          snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        displaySummary: `Prep done for today: ${item.title}`,
        planOnly: true,
      }
    case 'billing':
      // Overdue balances stay open until paid. Done means "I handled outreach
      // for now" and snoozes the personal card without rewriting the ledger.
      if (item.workKey.includes(':follow-up')) {
        return {
          actionKey: 'work.override',
          referencePayload: {
            workKey: item.workKey,
            state: 'snoozed',
            snoozedUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
          displaySummary: `Follow-up logged; remind later: ${item.title}`,
          planOnly: true,
        }
      }
      return null
    default:
      return null
  }
}
