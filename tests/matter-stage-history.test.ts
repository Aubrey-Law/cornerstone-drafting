import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20261009000000_matter_stage_history.sql'

/** The body of a `create or replace function` block, so an assertion about one
 *  function cannot be satisfied by text that lives in another. */
function functionBody(source: string, signatureStart: string): string {
  const start = source.indexOf(signatureStart)
  expect(start, `missing definition: ${signatureStart}`).toBeGreaterThan(-1)
  const end = source.indexOf('\n$$;', start)
  expect(end, `unterminated definition: ${signatureStart}`).toBeGreaterThan(-1)
  return source.slice(start, end)
}

describe('matter stage history', () => {
  it('records transitions insert-only, keyed to the matter', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain('create table if not exists public.matter_stage_history')
    expect(migration).toContain('matter_id uuid not null references public.matters(id) on delete cascade')
    expect(migration).toContain('to_stage text not null')
    // Staff read; only the service role writes. No update or delete grant, so
    // the record cannot be rewritten after the fact.
    expect(migration).toContain('grant select on public.matter_stage_history to authenticated')
    expect(migration).toContain('grant select, insert on public.matter_stage_history to service_role')
    expect(migration).not.toMatch(/grant[^\n]*\bupdate\b[^\n]*matter_stage_history/)
    expect(migration).not.toMatch(/grant[^\n]*\bdelete\b[^\n]*matter_stage_history/)
    expect(migration).toContain('alter table public.matter_stage_history enable row level security')
  })

  it('leaves the stage vocabulary unconstrained (catches the CHECK drift that hit the relationship history)', () => {
    const migration = read(MIGRATION)

    // matter_relationship_status_history pinned its CHECK to three states and
    // was left behind when lifecycle v3 added `declined`. Stage moves more
    // often still, so the history records whatever happened and `matters.stage`
    // is constrained at the source instead (20261007000000).
    expect(migration).not.toMatch(/(from_stage|to_stage)[^\n]*check\s*\(/i)
    expect(read('supabase/migrations/20261007000000_matters_stage_check.sql'))
      .toContain('add constraint matters_stage_check')
  })

  it('separates the business entry date from the write date', () => {
    const migration = read(MIGRATION)

    // A caller may pin stage_entered_at (20260910000000 lets the discovery
    // anchor set it to the call date), so a duration computed off created_at
    // would be wrong. Both are stored.
    expect(migration).toContain('entered_at timestamptz not null default now()')
    expect(migration).toContain('created_at timestamptz not null default now()')
    const body = functionBody(migration, 'create or replace function public.record_matter_stage_change()')
    expect(body).toContain('coalesce(new.stage_entered_at, now())')
  })

  it('fires after the BEFORE stamper and ignores writes that do not move the stage', () => {
    const migration = read(MIGRATION)
    const body = functionBody(migration, 'create or replace function public.record_matter_stage_change()')

    // AFTER, so trg_matters_stage_entered_at has already settled the date this
    // row records.
    expect(migration).toMatch(
      /create trigger record_matter_stage_change\s+after insert or update of stage on public\.matters/,
    )
    expect(body).toContain('if tg_op = \'UPDATE\' and new.stage is not distinct from old.stage then')
    expect(body).toContain('return new')
    // An insert has no previous stage to report.
    expect(body).toContain('case when tg_op = \'UPDATE\' then old.stage else null end')
  })

  it('resolves the actor the same way the relationship history does', () => {
    const body = functionBody(
      read(MIGRATION),
      'create or replace function public.record_matter_stage_change()',
    )

    expect(body).toContain("current_setting('app.actor_id', true)")
    expect(body).toContain('exception when invalid_text_representation')
    expect(body).toContain('coalesce(v_actor_id, auth.uid())')
  })

  it('backfills each matter once, from its own stage_entered_at', () => {
    const migration = read(MIGRATION)

    // Seeds a starting point rather than inventing transitions that were never
    // recorded, and re-running adds nothing.
    expect(migration).toContain('coalesce(m.stage_entered_at, m.created_at, now())')
    expect(migration).toMatch(
      /not exists\s*\(\s*select 1 from public\.matter_stage_history h where h\.matter_id = m\.id\s*\)/,
    )
    expect(migration).toContain('where m.stage is not null')
  })

  it('reloads the PostgREST schema cache', () => {
    expect(read(MIGRATION)).toContain("notify pgrst, 'reload schema'")
  })
})
