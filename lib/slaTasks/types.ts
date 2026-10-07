import type { TaskOwner, TaskRow } from '@/lib/tasks/types'

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
  // Revision then approval — see types/database.ts STAGES and
  // 20260913000000_revision_before_drafts_approved.sql. Invisible to the phase
  // views either way: `drafts_approved` is a review checkpoint carrying no
  // tasks, so it is filtered out before anything groups or sorts by phase.
  'revision',
  'drafts_approved',
  'signing_scheduled',
  'signing', // legacy v1
  'signing_complete',
  'post_execution',
  'post_signing', // legacy v1
  'funding',
  'closed',
  // Probate stages (lib/probateStages/model.ts). A probate matter's checklist
  // is filed under these rather than the estate-planning names above, which it
  // has no design, drafting or signing to match. They sit after `closed` so
  // the lead/matter boundary above is unchanged; a probate checklist ascends
  // through them on its own.
  'probate_opening',
  'probate_petition_filed',
  'probate_appointed',
  'probate_inventory_filed',
  'probate_claims_closed',
  'probate_distributed',
  'probate_closed',
] as const

export type SlaPhase = (typeof SLA_PHASES)[number]

/**
 * The phases that are also `matters.stage` values: everything but the probate
 * stages, which are read from dates and never written to that column. This is
 * the list `pipeline_stage_rank()` and the stage check must name.
 */
export const PIPELINE_SLA_PHASES: readonly SlaPhase[] = SLA_PHASES.filter(phase => !phase.startsWith('probate_'))

/**
 * Where the lead stages end and the matter stages begin.
 *
 * The list above is "lead stages, then matter stages", and `intake` is the
 * first stage a signed engagement reaches. Read as an index rather than
 * restated as a second list, so a phase added to either half is classified by
 * where it sits rather than by anyone remembering to update a copy.
 */
const ENGAGEMENT_BOUNDARY = SLA_PHASES.indexOf('intake')

/**
 * Work that happens before anyone has been engaged.
 *
 * The estate-planning checklist is 48 tasks, and only 11 of those are
 * pre-engagement; the rest are drafting, signing, funding and post-execution
 * work for a plan nobody has bought. Leads were once generated the whole thing,
 * which on 2026-08-24 put 709 unsold tasks in the firm queue across 39 leads.
 * A lead now gets only this half; see `PlanScope`.
 */
export function isPreEngagementPhase(phase: string | null | undefined): boolean {
  if (!phase) return false
  const index = SLA_PHASES.indexOf(phase as SlaPhase)
  return index >= 0 && index < ENGAGEMENT_BOUNDARY
}

/** The phases a lead's plan holds back until it converts. */
export const POST_ENGAGEMENT_PHASES: readonly string[] =
  SLA_PHASES.slice(ENGAGEMENT_BOUNDARY)

/**
 * Which half of a template a generation writes.
 *
 * A lead and the matter it becomes run separate task lists cut from the same
 * template at the engagement boundary. The lead list is the pre-engagement
 * stages and ends at "Client signs engagement agreement"; the matter list is
 * everything after, and is not created until the engagement is signed. `all`
 * is the whole template at once, for the manual generate route.
 */
export type PlanScope = 'lead' | 'matter' | 'all'

/** The phases a scope covers, or null for every phase. */
export function phasesForScope(scope: PlanScope): readonly string[] | null {
  if (scope === 'lead') return SLA_PHASES.slice(0, ENGAGEMENT_BOUNDARY)
  if (scope === 'matter') return POST_ENGAGEMENT_PHASES
  return null
}

export function isPhaseInScope(phase: string | null | undefined, scope: PlanScope): boolean {
  const phases = phasesForScope(scope)
  return phases === null || (!!phase && phases.includes(phase))
}

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
  probate_opening: 'Opening',
  probate_petition_filed: 'Petition Filed',
  probate_appointed: 'Appointed',
  probate_inventory_filed: 'Inventory Filed',
  probate_claims_closed: 'Claims Period Over',
  probate_distributed: 'Distributed',
  probate_closed: 'Estate Closed',
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

/**
 * The assignee vocabulary inside a stored template's JSONB. It predates the
 * merge into `tasks` and is left alone because it is data, not code; templates
 * are parsed through `ownerFromAssignee` into the `owner` a task row carries.
 */
export const SLA_ASSIGNEES = ['attorney', 'client', 'automation'] as const
export type SlaAssignee = (typeof SLA_ASSIGNEES)[number]

export function ownerFromAssignee(assignee: SlaAssignee): TaskOwner {
  return assignee === 'attorney' ? 'firm' : assignee
}

/**
 * Plan tasks use the one task-status vocabulary — there is no second set. The
 * old SLA statuses map on as pending→open, active→in_progress,
 * completed→done, blocked→blocked, and skipped→archived with `skipped_at` set.
 */

/**
 * What a task's offsets are measured from. `null` means Day 0 — the engagement
 * signature — which is the only anchor v1 templates use.
 */
export const SLA_ANCHORS = ['discovery_call', 'pmps'] as const
export type SlaAnchor = (typeof SLA_ANCHORS)[number]

/**
 * Every clock a task can hang off, including Day 0. Stored as `relative_to`,
 * where null means the engagement signature.
 */
export type SlaClockAnchor = SlaAnchor | 'engagement'

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

/**
 * A plan task: one `public.tasks` row with source = 'sla', read through the
 * plan's vocabulary.
 *
 * There is no second table and no second status vocabulary — this is a
 * projection, not a store. It exists because the plan reasons in calendar days
 * ("the organizer is due the day before the planning session") while `tasks`
 * stores timestamps, and because the plan calls a task's text its `name`. The
 * date keys below are derived from `hard_due_at` / `nudge_at` / `escalation_at`
 * by `toPlanTask`; nothing writes them directly.
 */
export interface PlanTask extends TaskRow {
  /** `title`, under the name the plan vocabulary uses. */
  name: string
  /** Calendar-day (YYYY-MM-DD) projections of the plan's timestamps. */
  start_date: string | null
  due_date: string | null
  nudge_date: string | null
  escalation_date: string | null

  // Narrowed from the string columns TaskRow declares.
  phase: SlaPhase | null
  relative_to: SlaAnchor | null
  nudge_tier: SlaNudgeTier | null
  escalation_tier: SlaNudgeTier | null
  gate: SlaGate | null
  variant: SlaVariant | null
}

/** A plan task with its matter's display names, for the cross-matter boards. */
export interface PlanTaskWithMatter extends PlanTask {
  matter_name: string | null
  client_name: string | null
}

/**
 * A plan task a due-date range query has already constrained to a real date. SQL
 * comparisons against null are never true, so `hard_due_at >= today` filters out
 * undated tasks on its own; this states that in the type.
 */
export type ScheduledPlanTask = PlanTaskWithMatter & { due_date: string }

/**
 * The `tasks` columns a plan read needs. The queue's own `TASK_COLUMNS` is a
 * subset of this — the plan additionally wants the anchor offsets, the nudge
 * clock and the pause bookkeeping.
 */
export const PLAN_TASK_COLUMNS =
  'id, title, description, status, priority, source, task_type, checklist, matter_id, lead_id, ' +
  'stage_key, stage_entered_at, batch_tag, soft_due_at, hard_due_at, due_at, assignee_id, ' +
  'estimate_minutes, remind_at, recurrence, template_id, document_id, completed_at, completed_by, ' +
  'created_by, created_at, updated_at, ' +
  'phase, owner, plan_template_id, sort_order, skill, notes, plan_start_date, relative_to, ' +
  'due_offset_days, nudge_offset_days, escalation_offset_days, nudge_at, nudge_tier, ' +
  'escalation_at, escalation_tier, nudge_sent_at, escalation_sent_at, pauses_clock, paused_at, ' +
  'total_paused_days, pre_engagement, auto, conditional, gate, variant, extends_target_days, ' +
  'recurring_interval_days, triggers_day_zero, skipped_at, closeout_reason'

export function isSlaPhase(value: unknown): value is SlaPhase {
  return typeof value === 'string' && (SLA_PHASES as readonly string[]).includes(value)
}

export function isSlaAnchor(value: unknown): value is SlaAnchor {
  return typeof value === 'string' && (SLA_ANCHORS as readonly string[]).includes(value)
}
