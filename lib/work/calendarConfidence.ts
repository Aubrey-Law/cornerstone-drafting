export interface CalendarConfidenceStatus {
  desiredBlocks: number
  syncedBlocks: number
  pendingBlocks: number
  staleBlocks: number
}

export type CalendarConfidence = {
  state: 'ready' | 'draft' | 'unavailable' | 'needs_sync'
  message: string | null
}

/**
 * Calendar time is a planning constraint, not a decorative integration badge.
 * This model makes unknown availability and incomplete holds explicit before a
 * user treats a committed schedule as safe to follow.
 */
export function getCalendarConfidence(input: {
  calendarUnavailable: boolean
  planStatus: 'draft' | 'committed' | 'closed' | null
  calendarStatus: CalendarConfidenceStatus | null
}): CalendarConfidence {
  if (input.calendarUnavailable) {
    return {
      state: 'unavailable',
      message: input.planStatus === 'committed'
        ? 'Calendar availability is unavailable. This plan is committed but its reserved time may conflict with external calendar changes.'
        : 'Calendar availability is unavailable. Review this risk before committing the plan.',
    }
  }
  if (input.planStatus !== 'committed') return { state: 'draft', message: null }
  if (!input.calendarStatus) {
    return { state: 'needs_sync', message: 'Calendar reservation status is unknown. Retry calendar sync before relying on this schedule.' }
  }
  if (input.calendarStatus.desiredBlocks === 0) return { state: 'ready', message: null }
  if (input.calendarStatus.pendingBlocks > 0 || input.calendarStatus.staleBlocks > 0 || input.calendarStatus.syncedBlocks < input.calendarStatus.desiredBlocks) {
    return {
      state: 'needs_sync',
      message: `${input.calendarStatus.syncedBlocks} of ${input.calendarStatus.desiredBlocks} planned blocks are reserved. Retry calendar sync before relying on this schedule.`,
    }
  }
  return { state: 'ready', message: null }
}
