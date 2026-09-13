export type WorkRunStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'

/**
 * `is_permitted` is owner, system, or an explicit share. It used to be computed
 * at the call site and then dropped on the floor here, so any attorney could
 * launch any other attorney's private skill by id.
 */
export function canLaunchSkill(input: { is_active: boolean; is_permitted: boolean }) {
  if (!input.is_permitted) return { ok: false as const, reason: 'forbidden' as const }
  return input.is_active ? { ok: true as const } : { ok: false as const, reason: 'inactive' as const }
}

const TRANSITIONS: Record<WorkRunStatus, WorkRunStatus[]> = {
  draft: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: ['awaiting_confirmation', 'confirmed'],
  failed: [],
  awaiting_confirmation: ['confirmed', 'cancelled'],
  confirmed: [],
  cancelled: [],
}

export function canTransitionRun(from: WorkRunStatus, to: WorkRunStatus) {
  return TRANSITIONS[from].includes(to)
}
