import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const sqlOf = (name: string) => readFileSync(join(root, 'supabase/migrations', name), 'utf8')

/**
 * The concurrency token for design-sheet saves.
 *
 * Deliberately NOT `version`: `20260813000001_design_sheet_unique_version.sql`
 * states the invariant "one design sheet per (matter_id, version)", so
 * incrementing it per save would redefine a documented column. And
 * deliberately not a row-per-save model — 26 files touch `design_sheets` and
 * only 10 order by version; `design-sheet/route.ts:73` calls `.maybeSingle()`,
 * which throws once a second version exists.
 */
describe('the lock_version migration', () => {
  const sql = sqlOf('20261120000000_design_sheet_lock_version.sql')

  it('adds the column with a default, so no row needs backfilling', () => {
    expect(sql).toMatch(/add column if not exists lock_version integer not null default 0/i)
  })

  it('leaves version alone', () => {
    // The whole point of a separate column.
    expect(sql).not.toMatch(/drop column .*\bversion\b|alter column version/i)
  })

  it('reloads PostgREST, which serves a cached schema', () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

/**
 * Moving the residuary to where the audit can see it.
 *
 * `ResiduarySection.tsx` writes `residuary_spouse_survives` and
 * `residuary_no_spouse` into `matters.li_design_sheet_data`. The audit reads
 * `design_sheet.residuary_beneficiary`, a column nothing writes. Seven of the
 * nine blocker findings raised on 2026-09-08/09 were against matters that DO
 * have a residuary recorded.
 */
describe('the li_design_sheet_data fold', () => {
  const sql = sqlOf('20261121000000_fold_li_design_sheet_data.sql')

  it('merges the blob into the latest sheet’s decisions', () => {
    expect(sql).toMatch(/decisions\s*=\s*coalesce\(d\.decisions, '\{\}'::jsonb\)\s*\|\|/i)
  })

  it('targets the latest version only, since readers take max(version)', () => {
    expect(sql).toMatch(/max\(version\)/i)
  })

  it('refuses rather than merging when a key already exists', () => {
    // Measured at zero collisions on 2026-09-10 — asserted here rather than
    // trusted, because a merge that silently overwrote a decision would be
    // undetectable afterwards.
    expect(sql).toMatch(/raise exception/i)
    expect(sql).toMatch(/\?\|/)
  })

  it('does not drop the column it reads from', () => {
    // 17 code sites still read it. The repo's rule, from
    // 20261013000000_drop_twenty_sync_columns.sql: a column is never dropped
    // in the same PR as its last code reference, because migrations and code
    // deploy in no guaranteed order.
    expect(sql).not.toMatch(/drop column .*li_design_sheet_data/i)
  })
})
