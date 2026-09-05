import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSET_FUNDING_COLUMNS } from '@/lib/funding/repository'
import { FUNDING_METHODS, FUNDING_STATUSES } from '@/lib/funding/model'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261025000000_asset_funding.sql'),
  'utf8',
)

/**
 * `asset_funding` is created by the migration in this change, so it is not in
 * the generated types yet and the app declares its shape locally. That is a
 * bridge, and a bridge needs a handrail: this compares the declared shape and
 * the vocabularies against the SQL itself, so the two cannot drift while they
 * are apart.
 *
 * When the types regenerate after this merges, the local shape goes and so
 * does this test.
 */
describe('the asset_funding table and the shape the app declares for it', () => {
  // Scoped to the create-table block. Scanning the whole file also picks up
  // `v_category text` from the trigger function's DECLARE, which is a local
  // variable and not a column.
  const createTable = MIGRATION.slice(
    MIGRATION.indexOf('create table if not exists public.asset_funding ('),
    MIGRATION.indexOf('create index'),
  )
  const columns = [...createTable.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|date|timestamptz)/gm)].map((m) => m[1])

  it('reads real columns out of the migration', () => {
    expect(columns.length).toBeGreaterThan(5)
  })

  it('declares exactly the columns the table has', () => {
    expect([...ASSET_FUNDING_COLUMNS].sort()).toEqual([...columns].sort())
  })

  it('constrains method to the vocabulary the app uses', () => {
    for (const method of FUNDING_METHODS) expect(MIGRATION).toContain(`'${method}'`)
  })

  it('constrains status to the vocabulary the app uses', () => {
    for (const status of FUNDING_STATUSES) expect(MIGRATION).toContain(`'${status}'`)
  })

  /**
   * The two rules the database enforces itself, because the application is not
   * the only thing that can write to this table.
   */
  it('refuses a confirmed row with no confirmation date', () => {
    expect(MIGRATION).toMatch(/status <> 'confirmed' or confirmed_on is not null/)
  })

  it('refuses to record a retirement account as retitled or deeded', () => {
    expect(MIGRATION).toContain('assert_retirement_funding_method')
    expect(MIGRATION).toMatch(/taxable distribution/i)
  })

  it('scopes funding to one matter and one asset', () => {
    expect(MIGRATION).toContain('unique (matter_id, asset_intake_id)')
  })
})
