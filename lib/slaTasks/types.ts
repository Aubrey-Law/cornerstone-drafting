export const SLA_PHASES = [
  'onboarding',
  'design',
  'drafting',
  'review',
  'signing',
  'post_signing',
] as const

export type SlaPhase = (typeof SLA_PHASES)[number]

export const SLA_PHASE_LABEL: Record<SlaPhase, string> = {
  onboarding: 'Onboarding',
  design: 'Design',
  drafting: 'Drafting',
  review: 'Review',
  signing: 'Signing',
  post_signing: 'Post-signing',
}

export const SLA_NUDGE_TIERS = ['gentle', 'firm', 'internal'] as const
export type SlaNudgeTier = (typeof SLA_NUDGE_TIERS)[number]

export const SLA_ASSIGNEES = ['attorney', 'client'] as const
export type SlaAssignee = (typeof SLA_ASSIGNEES)[number]

export const SLA_TASK_STATUSES = ['pending', 'active', 'completed', 'skipped', 'blocked'] as const
export type SlaTaskStatus = (typeof SLA_TASK_STATUSES)[number]

/** Statuses that still consume the clock — a task in one of these is open work. */
export const SLA_OPEN_STATUSES: SlaTaskStatus[] = ['pending', 'active', 'blocked']

/** One task definition inside a template's `tasks` array. */
export interface SlaTemplateTask {
  phase: SlaPhase
  name: string
  due_offset_days: number
  nudge_offset_days: number | null
  nudge_tier: SlaNudgeTier | null
  escalation_offset_days: number | null
  escalation_tier: SlaNudgeTier | null
  assignee: SlaAssignee
  skill: string | null
  auto: boolean
  conditional: boolean
  pauses_clock: boolean
}

export interface SlaTemplateRow {
  id: string
  template_name: string
  description: string | null
  target_days: number
  tasks: SlaTemplateTask[]
  created_at: string
  updated_at: string
}

export interface MatterTaskRow {
  id: string
  matter_id: string
  template_id: string | null
  phase: SlaPhase
  name: string
  sort_order: number
  assignee: SlaAssignee
  skill: string | null
  conditional: boolean
  pauses_clock: boolean
  start_date: string
  due_date: string
  nudge_date: string | null
  nudge_tier: SlaNudgeTier | null
  escalation_date: string | null
  escalation_tier: SlaNudgeTier | null
  status: SlaTaskStatus
  completed_at: string | null
  skipped_at: string | null
  notes: string | null
  paused_at: string | null
  total_paused_days: number
  nudge_sent_at: string | null
  escalation_sent_at: string | null
  created_at: string
  updated_at: string
}

/** A matter task with its matter's display names, for the cross-matter boards. */
export interface MatterTaskWithMatter extends MatterTaskRow {
  matter_name: string | null
  client_name: string | null
}

export const MATTER_TASK_COLUMNS =
  'id, matter_id, template_id, phase, name, sort_order, assignee, skill, conditional, pauses_clock, ' +
  'start_date, due_date, nudge_date, nudge_tier, escalation_date, escalation_tier, status, ' +
  'completed_at, skipped_at, notes, paused_at, total_paused_days, nudge_sent_at, escalation_sent_at, ' +
  'created_at, updated_at'

export function isSlaPhase(value: unknown): value is SlaPhase {
  return typeof value === 'string' && (SLA_PHASES as readonly string[]).includes(value)
}

export function isSlaTaskStatus(value: unknown): value is SlaTaskStatus {
  return typeof value === 'string' && (SLA_TASK_STATUSES as readonly string[]).includes(value)
}
