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
})
