export type WorkRunStatus =
  | 'draft'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'

export function canLaunchSkill(input: { is_active: boolean; is_owner: boolean }) {
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
