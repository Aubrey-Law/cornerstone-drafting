import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270102090000_command_center_foundation.sql'),
  'utf8',
)
const shadowRollout = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270102090100_command_center_shadow_rollout.sql'),
  'utf8',
)
const rolloutMetrics = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270102090200_command_center_rollout_metrics.sql'),
  'utf8',
)
const phaseFiveCutover = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20270102090500_command_center_phase5_cutover.sql'),
  'utf8',
)

describe('command center database foundation', () => {
  for (const table of [
    'user_work_preferences', 'work_item_overrides', 'daily_plans', 'daily_plan_items',
    'action_proposals', 'action_executions', 'automation_rules', 'automation_runs',
  ]) {
    it(`creates and protects ${table}`, () => {
      expect(migration).toContain(`create table public.${table}`)
      expect(migration).toContain(`alter table public.${table} enable row level security`)
    })
  }

  it('does not create a duplicate work_items table', () => {
    expect(migration).not.toMatch(/create table public\.work_items\b/)
  })

  it('explicitly grants authenticated access for the newer Data API defaults', () => {
    expect(migration).toContain('revoke all on table')
    expect(migration).toContain('to authenticated')
  })

  it('keeps the command center opt-in until shadow reconciliation passes', () => {
    expect(migration).toContain('command_center_v2_enabled boolean not null default false')
    expect(shadowRollout).toContain('set command_center_v2_enabled = false')
  })

  it('stores aggregate-only shadow evidence behind staff RLS', () => {
    expect(rolloutMetrics).toContain('create table public.work_graph_reconciliation_runs')
    expect(rolloutMetrics).toContain('enable row level security')
    expect(rolloutMetrics).toContain('work_graph_reconciliation_staff_select')
    expect(rolloutMetrics).not.toMatch(/\n\s+(title|message_body|legal_fact|work_key)\s/)
  })

  it('stores aggregate-only parallel-run usage and service-role-only writes', () => {
    expect(phaseFiveCutover).toContain('create table public.command_center_usage_daily')
    expect(phaseFiveCutover).toContain('alter table public.command_center_usage_daily enable row level security')
    expect(phaseFiveCutover).toContain('create policy command_center_usage_staff_select')
    expect(phaseFiveCutover).toContain('grant select on table public.command_center_usage_daily to authenticated')
    expect(phaseFiveCutover).toContain('grant execute on function public.record_command_center_usage')
    expect(phaseFiveCutover).toMatch(/grant execute[\s\S]+to service_role/)
    expect(phaseFiveCutover).toMatch(/revoke all on function[\s\S]+from public, anon, authenticated/)
    expect(phaseFiveCutover).not.toMatch(/\n\s+(title|message_body|legal_fact|work_key|source_id|record_id)\s/)
  })
})
