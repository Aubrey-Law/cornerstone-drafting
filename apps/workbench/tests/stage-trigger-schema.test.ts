import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261103000000_stage_triggered_runs.sql'),
  'utf8',
)

describe('the stage-trigger migration', () => {
  it('lets a prompt declare which stage entries fire it, firing none by default', () => {
    // Empty by default is what makes this safe to deploy: the two prompts
    // that already exist keep behaving exactly as they do until told
    // otherwise, in a separate migration.
    expect(sql).toMatch(/fires_on_stage_entry text\[\] not null default '\{\}'/)
  })

  it('fires AFTER the update, not before', () => {
    // `stage_entered_at` is set by a BEFORE trigger (20260711000000). A
    // BEFORE trigger here would read the previous entry's timestamp, reuse
    // its de-duplication key, and silently suppress the re-audit this
    // exists to allow.
    expect(sql).toMatch(/after update of stage on public\.matters/)
    expect(sql).not.toMatch(/before update of stage on public\.matters/)
  })

  it('does not fire when an update writes the same stage back', () => {
    // Without this, saving any unrelated field on a matter — a note, a
    // contact detail — would re-fire every prompt that cares about the
    // matter's current stage, dozens of times a day.
    expect(sql).toMatch(/when \(new\.stage is distinct from old\.stage\)/)
  })

  it('cannot record the same stage entry twice', () => {
    expect(sql).toMatch(/unique \(matter_id, prompt_id, stage_entered_at\)/)
  })

  it('claims a trigger without two ticks getting the same one', () => {
    expect(sql).toMatch(/for update skip locked/)
    expect(sql).toMatch(/create or replace function public\.claim_prompt_stage_trigger/)
  })

  it('runs the claim as its definer with a pinned search path', () => {
    expect(sql).toMatch(/security definer set search_path = pg_catalog, public/)
  })

  it('protects the new table with row level security', () => {
    expect(sql).toContain('alter table public.prompt_stage_triggers enable row level security')
  })
})
