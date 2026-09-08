import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261106000000_field_change_triggers.sql'),
  'utf8',
)

/**
 * The migration with its `--` comment lines removed. Assertions about what the
 * migration *does* read this, not the raw text: this migration's comments
 * quote the rejected trigger shape verbatim, so a negative assertion against
 * the raw text would fail on the explanation of why that shape is absent —
 * and a positive one could be satisfied by a comment that merely mentions the
 * statement. SQL string literals are kept, so `comment on column` bodies are
 * still assertable.
 */
const STATEMENTS = MIGRATION.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

describe('the field-change trigger migration', () => {
  it('lets a prompt declare which field changes fire it, firing none by default', () => {
    // Empty by default is what makes this safe to deploy: this migration ships
    // the mechanism and no prompt watches anything, so the new trigger fires
    // nothing until a later migration says which prompt should.
    expect(STATEMENTS).toMatch(/fires_on_field_change text\[\] not null default '\{\}'/)
  })

  it('relaxes to_stage so a row can record a cause other than a stage', () => {
    expect(STATEMENTS).toMatch(/alter column to_stage drop not null/)
    expect(STATEMENTS).toMatch(/add column if not exists on_field text/)
  })

  it('requires exactly one cause, never both and never neither', () => {
    // `<>` on two nullability tests is the whole constraint: a row with
    // neither says nothing about why it exists, and a row with both makes the
    // reason ambiguous to anyone reading the queue later.
    expect(STATEMENTS).toMatch(
      /add constraint prompt_stage_triggers_one_cause\s+check \(\(to_stage is null\) <> \(on_field is null\)\)/,
    )
  })

  it('keeps stage_entered_at, and says in its comment what it now holds', () => {
    // Renaming it would mean recreating the unique index that backs this
    // queue's de-duplication, on a working path, for cosmetic gain.
    expect(MIGRATION).not.toMatch(/rename column stage_entered_at/)
    expect(STATEMENTS).toMatch(/comment on column public\.prompt_stage_triggers\.stage_entered_at is/)
    expect(STATEMENTS).toContain('or the transaction timestamp of the edit for an on_field')
  })

  it('fires on an insert, and on an update only when the notes really changed', () => {
    // Two triggers over one function, because Postgres rejects a combined
    // `after insert or update` trigger whose WHEN condition references OLD:
    // it validates the condition against every declared event and an INSERT
    // has no OLD row. Splitting is the only way to give the two events
    // different conditions — an insert needs none, an update needs one.
    expect(STATEMENTS).toMatch(/after insert on public\.design_sheets/)
    expect(STATEMENTS).toMatch(/after update of drafting_notes on public\.design_sheets/)
    expect(STATEMENTS).toMatch(/when \(new\.drafting_notes is distinct from old\.drafting_notes\)/)

    // The shape that cannot be created: no OLD in the insert trigger's WHEN.
    expect(STATEMENTS).not.toMatch(/after insert or update of drafting_notes/)
    expect(STATEMENTS).not.toContain('old.id is null')
  })

  it('fires both events through the same function, so the two cannot drift', () => {
    expect(STATEMENTS).toMatch(
      /create or replace function public\.trg_design_sheets_fire_field_prompts\(\)/,
    )
    const executions = STATEMENTS.match(
      /execute function public\.trg_design_sheets_fire_field_prompts\(\)/g,
    )
    expect(executions).toHaveLength(2)
  })

  /**
   * The first draft keyed de-duplication on the sheet's `updated_at`, which no
   * trigger maintains — so every edit of a sheet would share one frozen
   * insert-time value and the unique constraint would have suppressed every
   * re-audit after the first, forever, while looking exactly like
   * de-duplication working.
   */
  it('keys de-duplication on now(), never on the sheet’s updated_at', () => {
    expect(STATEMENTS).toMatch(
      /select\s+new\.matter_id,\s*p\.id,\s*'design_sheet\.drafting_notes',\s*now\(\)/,
    )
    expect(MIGRATION).not.toContain('new.updated_at')
  })

  it('lets two writes of the same change in one transaction fire once', () => {
    expect(STATEMENTS).toMatch(
      /on conflict \(matter_id, prompt_id, stage_entered_at\) do nothing/,
    )
  })

  it('watches an allow-listed source key, not a column name', () => {
    // 'design_sheet.drafting_notes' is a key in SOURCE_ALLOW_LIST
    // (packages/citations/src/prompt/inputs.ts), so a prompt cannot widen what
    // it watches by naming a column.
    expect(STATEMENTS).toContain("'design_sheet.drafting_notes' = any (p.fires_on_field_change)")
  })

  it('runs the trigger function as its definer with a pinned search path', () => {
    expect(STATEMENTS).toMatch(/security definer set search_path = pg_catalog, public/)
  })

  it('seeds no prompt and adds no prompt version, because the mechanism is not the prompt', () => {
    // This slice ships the trigger armed and inert. A prompt that watches the
    // field is a separate migration; a version here would make every existing
    // run's findings look like they came from superseded wording.
    expect(STATEMENTS).not.toMatch(/insert into public\.prompt_versions/)
    expect(STATEMENTS).not.toMatch(/insert into public\.prompts/)
    expect(STATEMENTS).not.toMatch(/set fires_on_field_change =/)
  })
})
