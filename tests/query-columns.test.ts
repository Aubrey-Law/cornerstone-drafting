import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { collectQueryReferences, CHECKED_ROOTS } from '../scripts/lib/queryReferences.mjs'
import { schemaColumns } from './helpers/schemaColumns'

const repoRoot = path.resolve(__dirname, '..')

/**
 * Tables the generated types do not describe yet, with why.
 *
 * Empty, and worth keeping empty: a table here is exempt from the column check,
 * and the queries reading it lose the compile-time check too, because a typed
 * client cannot describe a table its types do not contain. That is how
 * `matters.title` survived — the repositories cast the client to
 * `SupabaseClient<never>` so the new tables would compile, which switched off
 * column checking for every table they touched, including the typed ones.
 *
 * Add an entry only for a table whose migration has not reached the generated
 * types yet, then regenerate them (`db-types-drift.yml`, dispatched with
 * `open_pr`) and remove it. The last test below fails once an entry is stale,
 * so the exemption cannot outlive its reason.
 */
const TABLES_AWAITING_TYPES: Record<string, string> = {}

/**
 * The offline half of the guard on invented column names.
 *
 * Five features shipped reading `matters.title`, which has never existed, and
 * every unit test passed because each one built its fixture rows from the same
 * wrong assumption. Fixtures cannot catch this; only the schema can.
 */
describe('every column the checked code queries exists in the schema', () => {
  const schema = schemaColumns()
  const { references, embedded } = collectQueryReferences({ roots: CHECKED_ROOTS, repoRoot })

  it('finds queries to check', () => {
    // Passing on nothing is how a guard stops guarding without anyone noticing.
    expect(references.length).toBeGreaterThan(100)
    expect(new Set(references.map((r) => r.table)).size).toBeGreaterThan(10)
    // Every table is typed, so nothing is exempt and everything is checked.
    expect(references.filter((r) => !schema.has(r.table))).toEqual([])
  })

  it('reads no column a typed table does not have', () => {
    const wrong = references
      .filter((r) => schema.has(r.table))
      .filter((r) => !schema.get(r.table)!.has(r.column))
      .map((r) => `${r.file}:${r.line} ${r.table}.${r.column}`)
    expect(wrong).toEqual([])
  })

  it('queries no table that is neither typed nor a known new one', () => {
    const unknown = references
      .filter((r) => !schema.has(r.table) && !(r.table in TABLES_AWAITING_TYPES))
      .map((r) => `${r.file}:${r.line} ${r.table}`)
    expect([...new Set(unknown)]).toEqual([])
  })

  it('exempts only tables the generated types really are missing', () => {
    const stale = Object.keys(TABLES_AWAITING_TYPES).filter((table) => schema.has(table))
    expect(stale).toEqual([])
  })

  it('meets no embedded select it cannot read', () => {
    // PostgREST embedding (`matter_documents(id, name)`) would need the columns
    // split per table. There are none, and this fails rather than skipping if
    // one arrives, so the check cannot quietly narrow.
    expect(embedded).toEqual([])
  })
})
