import type { TaskRow } from '@/lib/tasks/types'

/**
 * A `tasks` row with everything at its default.
 *
 * Shared because `tasks` now carries the SLA plan's columns as well as the
 * queue's, and five test files were each spelling the whole row out. Override
 * only what the case under test is about.
 */
export function taskFixture(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: 'Call the client',
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'manual',
    task_type: 'single',
    checklist: [],
    matter_id: null,
    lead_id: null,
    stage_key: null,
    stage_entered_at: null,
    batch_tag: null,
    soft_due_at: null,
    hard_due_at: null,
    due_at: null,
    assignee_id: null,
    estimate_minutes: null,
    remind_at: null,
    recurrence: null,
    template_id: null,
    document_id: null,
    completed_at: null,
    completed_by: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',

    // Plan columns — see supabase/migrations/20261003000000_tasks_absorb_sla_plan.sql
    phase: null,
    owner: 'firm',
    plan_template_id: null,
    sort_order: 0,
    skill: null,
    notes: null,
    plan_start_date: null,
    relative_to: null,
    due_offset_days: null,
    nudge_offset_days: null,
    escalation_offset_days: null,
    nudge_at: null,
    nudge_tier: null,
    escalation_at: null,
    escalation_tier: null,
    nudge_sent_at: null,
    escalation_sent_at: null,
    pauses_clock: false,
    paused_at: null,
    total_paused_days: 0,
    pre_engagement: false,
    auto: false,
    conditional: false,
    gate: null,
    variant: null,
    extends_target_days: null,
    recurring_interval_days: null,
    triggers_day_zero: false,
    skipped_at: null,
    closeout_reason: null,

    ...overrides,
  }
}
