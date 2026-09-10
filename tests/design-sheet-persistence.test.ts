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
