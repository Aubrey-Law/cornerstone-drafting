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

describe('turning firing on for the design-sheet audit', () => {
  const fireSql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261103010000_fire_design_sheet_audit.sql'),
    'utf8',
  )

  it('fires on design and drafting, and names the prompt by slug', () => {
    expect(fireSql).toMatch(/array\['design', 'drafting'\]/)
    expect(fireSql).toContain("slug = 'ma-design-sheet-audit'")
  })

  it('does not add a prompt version, because when a prompt runs is not what it says', () => {
    // A new version here would make every existing run's findings look like
    // they came from superseded wording when the wording never changed.
    expect(fireSql).not.toMatch(/insert into public\.prompt_versions/)
  })

  it('leaves the review playbook alone', () => {
    expect(fireSql).not.toContain('ma-trust-firm-qa')
  })
})

/**
 * The reclaim, added 2026-09-09 after two triggers were stranded in `claimed`
 * for ever: no run, no `last_error`, and a claim function that selected only
 * `pending`, so nothing would ever look at them again. Two matters were simply
 * never audited and no screen said so.
 */
describe('the stale-claim reclaim migration', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261115000000_reclaim_stale_stage_triggers.sql'),
    'utf8',
  )

  it('counts abandonments on the row itself', () => {
    expect(sql).toMatch(/add column if not exists reclaims integer not null default 0/)
  })

  it('claims a stale claim as well as a pending one', () => {
    expect(sql).toMatch(/status = 'pending'/)
    expect(sql).toMatch(/status = 'claimed'/)
    expect(sql).toMatch(/claimed_at < statement_timestamp\(\) - v_stale_after/)
  })

  /**
   * The cap is the point. The throw that stranded those two was deterministic —
   * a sentinel `contact_id` Postgres rejects at a uuid column — so an uncapped
   * reclaim would have retried them once a minute for ever, turning a silent
   * loss into a silent loop.
   */
  it('caps the reclaims rather than retrying for ever', () => {
    expect(sql).toMatch(/v_max_reclaims constant integer := 3/)
    expect(sql).toMatch(/reclaims < v_max_reclaims/)
  })

  /**
   * And gives up *visibly*. The original defect was a row that said "someone is
   * working on this" while nobody was; an over-cap row left `claimed` would be
   * the same defect with extra steps.
   */
  it('settles an over-cap row skipped, with a reason, rather than leaving it claimed', () => {
    expect(sql).toMatch(/set status = 'skipped'/)
    expect(sql).toMatch(/reclaims >= v_max_reclaims/)
    expect(sql).toMatch(/last_error = 'Abandoned by '/)
  })

  /** Only a reclaim increments, so the cap measures abandonment and not
   *  attempts — a first claim has to leave the counter alone. */
  it('increments only when it is re-claiming', () => {
    expect(sql).toMatch(/case when t\.status = 'claimed' then 1 else 0 end/)
  })

  /** Oldest first, so a reclaim cannot starve a fresh signal. */
  it('still takes the oldest first, and still skips locked rows', () => {
    expect(sql).toMatch(/order by created_at/)
    expect(sql).toMatch(/for update skip locked/)
  })

  /** The same patience the run reaper uses, rather than a second opinion about
   *  how long is too long. */
  it('agrees with the run reaper on what stale means', () => {
    expect(sql).toMatch(/interval '10 minutes'/)
    const reaper = fs.readFileSync(path.resolve(__dirname, '../lib/runs/reaper.ts'), 'utf8')
    expect(reaper).toMatch(/STALE_AFTER_MS = 10 \* 60_000/)
    expect(reaper).toMatch(/MAX_RECLAIMS = 3/)
  })
})
