import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_KINDS } from '@/lib/execution/requirements'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261026000000_signing_ceremonies.sql'),
  'utf8',
)

/**
 * The document kinds and the rules the app checks before writing must match
 * what the ceremony tables themselves enforce.
 */
describe('the ceremony tables and the vocabulary the app uses for them', () => {
  it('constrains document_kind to the kinds the execution engine knows', () => {
    for (const kind of DOCUMENT_KINDS) expect(MIGRATION).toContain(`'${kind}'`)
  })

  /**
   * The two rules the database keeps for itself, because a claim with nothing
   * behind it is the failure mode of every record in this feature.
   */
  it('refuses an executed document with no signing date', () => {
    expect(MIGRATION).toMatch(/executed = false or signed_on is not null/)
  })

  it('refuses a completed ceremony with no completion time', () => {
    expect(MIGRATION).toMatch(/status <> 'completed' or completed_at is not null/)
  })

  it('keeps one row per document per ceremony', () => {
    expect(MIGRATION).toContain('unique (ceremony_id, document_kind)')
  })
})
