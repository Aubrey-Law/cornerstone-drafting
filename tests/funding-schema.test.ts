import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FUNDING_METHODS, FUNDING_STATUSES } from '@/lib/funding/model'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261025000000_asset_funding.sql'),
  'utf8',
)

/**
 * The funding vocabularies and the two rules the app checks before writing
 * must match what the table itself enforces, so a form that offers a value
 * the database refuses — or a rule the app forgets — shows up here first.
 */
describe('the asset_funding table and the vocabulary the app uses for it', () => {
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
