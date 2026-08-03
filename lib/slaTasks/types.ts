/**
 * A task's phase is the Cornerstone pipeline stage it belongs to, not a second
 * vocabulary sitting alongside one. Grouping the checklist by stage means the
 * SLA plan and the stage strip on the matter header always agree, and "the
 * matter is in Drafting" and "the Drafting tasks are open" are the same fact.
 *
 * The list is the lead stages followed by the matter stages from
 * `types/database.ts`, interleaved with the four legacy phase names the v1
 * template (`estate_planning_sla`) generated before stages and phases were
 * unified. Those are kept so matters already running on v1 still render; they
 * are ordered so that either template's phases ascend through this list, and
 * progress summaries drop phases with no tasks.
 */
export const SLA_PHASES = [
  // Lead stages
  'new_lead',
  'intake_sent',
  'intake_completed',
  'engagement_sent',
  // Matter stages
  'intake',
  'intake_review',
  'onboarding', // legacy v1
  'design',
  'drafting',
  'review', // legacy v1
  'client_review',
  'drafts_approved',
  'revision',
  'signing_scheduled',
  'signing', // legacy v1
  'signing_complete',
  'post_execution',
  'post_signing', // legacy v1
  'funding',
  'closed',
] as const

export type SlaPhase = (typeof SLA_PHASES)[number]

export const SLA_PHASE_LABEL: Record<SlaPhase, string> = {
  new_lead: 'Discovery',
  intake_sent: 'Organizer Sent',
  intake_completed: 'Planning Session',
  engagement_sent: 'Recommendations Sent',
  intake: 'Engaged',
  intake_review: 'Intake Review',
  onboarding: 'Onboarding',
  design: 'Design',
  drafting: 'Drafting',
  review: 'Review',
  client_review: 'Client Review',
  drafts_approved: 'Drafts Approved',
  revision: 'Revision',
  signing_scheduled: 'Ready to Sign',
  signing: 'Signing',
  signing_complete: 'Signed',
  post_execution: 'Post-Signing',
  post_signing: 'Post-signing',
  funding: 'Funding',
  closed: 'Complete',
}

/** Phases that run before the engagement is signed, on the soft clock. */
export const SLA_PRE_ENGAGEMENT_PHASES: SlaPhase[] = [
  'new_lead',
  'intake_sent',
  'intake_completed',
  'engagement_sent',
]

export const SLA_NUDGE_TIERS = ['gentle', 'firm', 'internal'] as const
export type SlaNudgeTier = (typeof SLA_NUDGE_TIERS)[number]

export const SLA_ASSIGNEES = ['attorney', 'client', 'automation'] as const
export type SlaAssignee = (typeof SLA_ASSIGNEES)[number]

export const SLA_TASK_STATUSES = ['pending', 'active', 'completed', 'skipped', 'blocked'] as const
export type SlaTaskStatus = (typeof SLA_TASK_STATUSES)[number]

/** Statuses that still consume the clock — a task in one of these is open work. */
export const SLA_OPEN_STATUSES: SlaTaskStatus[] = ['pending', 'active', 'blocked']

/**
 * What a task's offsets are measured from. `null` means Day 0 — the engagement
 * signature — which is the only anchor v1 templates use.
 */
export const SLA_ANCHORS = ['discovery_call', 'pmps'] as const
export type SlaAnchor = (typeof SLA_ANCHORS)[number]

/** Resolved anchor dates for one matter. Absent or null = not yet known. */
export interface SlaAnchorDates {
  /** Day 0. Falls back to the generation start date when unsigned. */
  engagement?: string | null
  discovery_call?: string | null
  pmps?: string | null
}

/** Preconditions that must hold before a gated task is generated. */
export const SLA_GATES = ['fit_confirmed'] as const
export type SlaGate = (typeof SLA_GATES)[number]

/** Alternative branches; a task with no variant always applies. */
export const SLA_VARIANTS = ['remote_signing'] as const
export type SlaVariant = (typeof SLA_VARIANTS)[number]

/** One task definition inside a template's `tasks` array. */
export interface SlaTemplateTask {
  phase: SlaPhase
  name: string
  /** Null when the task has no deadline of its own (client-driven scheduling). */
  due_offset_days: number | null
  nudge_offset_days: number | null
  nudge_tier: SlaNudgeTier | null
  escalation_offset_days: number | null
  escalation_tier: SlaNudgeTier | null
  assignee: SlaAssignee
  skill: string | null
  auto: boolean
  conditional: boolean
  pauses_clock: boolean
  relative_to: SlaAnchor | null
  pre_engagement: boolean
  gate: SlaGate | null
  extends_target_days: number | null
  recurring_interval_days: number | null
  variant: SlaVariant | null
  triggers_day_zero: boolean
}

export interface SlaTemplateRow {
  id: string
  template_name: string
  description: string | null
  target_days: number
  target_days_pre_engagement: number | null
  target_days_engagement: number | null
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
  /** Null while the task's anchor has not happened yet. */
  due_date: string | null
  nudge_date: string | null
  nudge_tier: SlaNudgeTier | null
  escalation_date: string | null
  escalation_tier: SlaNudgeTier | null
  due_offset_days: number | null
  nudge_offset_days: number | null
  escalation_offset_days: number | null
  relative_to: SlaAnchor | null
  pre_engagement: boolean
  auto: boolean
  gate: SlaGate | null
  extends_target_days: number | null
  recurring_interval_days: number | null
  variant: SlaVariant | null
  triggers_day_zero: boolean
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

/**
 * A task a due-date range query has already constrained to a real date. SQL
 * comparisons against null are never true, so `due_date >= today` filters out
 * undated tasks on its own; this states that in the type.
 */
export type ScheduledMatterTask = MatterTaskWithMatter & { due_date: string }

export const MATTER_TASK_COLUMNS =
  'id, matter_id, template_id, phase, name, sort_order, assignee, skill, conditional, pauses_clock, ' +
  'start_date, due_date, nudge_date, nudge_tier, escalation_date, escalation_tier, ' +
  'due_offset_days, nudge_offset_days, escalation_offset_days, relative_to, pre_engagement, auto, ' +
  'gate, extends_target_days, recurring_interval_days, variant, triggers_day_zero, status, ' +
  'completed_at, skipped_at, notes, paused_at, total_paused_days, nudge_sent_at, escalation_sent_at, ' +
  'created_at, updated_at'

export function isSlaPhase(value: unknown): value is SlaPhase {
  return typeof value === 'string' && (SLA_PHASES as readonly string[]).includes(value)
}

export function isSlaTaskStatus(value: unknown): value is SlaTaskStatus {
  return typeof value === 'string' && (SLA_TASK_STATUSES as readonly string[]).includes(value)
}

export function isSlaAnchor(value: unknown): value is SlaAnchor {
  return typeof value === 'string' && (SLA_ANCHORS as readonly string[]).includes(value)
}
