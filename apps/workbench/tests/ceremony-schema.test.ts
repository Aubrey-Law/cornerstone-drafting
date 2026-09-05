import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CEREMONY_DOCUMENT_COLUMNS,
  SIGNING_CEREMONY_COLUMNS,
} from '@/lib/ceremony/repository'
import { DOCUMENT_KINDS } from '@/lib/execution/requirements'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261026000000_signing_ceremonies.sql'),
  'utf8',
)

const columnsOf = (table: string) => {
  const start = MIGRATION.indexOf(`create table if not exists public.${table} (`)
  const end = MIGRATION.indexOf('create index', start)
  const block = MIGRATION.slice(start, end)
  return [...block.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|date|timestamptz|boolean|integer)/gm)].map((m) => m[1])
}

/**
 * The tables are created by the migration in this change, so the app declares
 * their shape locally until the generated types catch up. This compares the two
 * against the SQL itself so they cannot drift while they are apart.
 */
describe('the ceremony tables and the shapes the app declares', () => {
  it('declares exactly the signing_ceremonies columns', () => {
    expect([...SIGNING_CEREMONY_COLUMNS].sort()).toEqual(columnsOf('signing_ceremonies').sort())
  })

  it('declares exactly the ceremony_documents columns', () => {
    expect([...CEREMONY_DOCUMENT_COLUMNS].sort()).toEqual(columnsOf('ceremony_documents').sort())
  })

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
