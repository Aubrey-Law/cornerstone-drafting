import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { collectQueryReferences, WORKBENCH_ROOTS } from '../../../scripts/lib/queryReferences.mjs'

const repoRoot = path.resolve(__dirname, '../../..')
const generated = path.join(repoRoot, 'packages/db-types/src/supabase.generated.ts')

/**
 * Tables the generated types do not describe yet, with why.
 *
 * A table here is exempt from this check only; `npm run check:db-columns` asks
 * the live database and exempts nothing. The list still has to stay true — the
 * test below fails once an entry appears in the generated types, which is what
 * stops the exemption from outliving the reason for it.
 */
const TABLES_AWAITING_TYPES: Record<string, string> = {
  workflow_runs: 'added by 20261027000000_workflow_runs_and_findings.sql',
  workflow_findings: 'added by 20261027000000_workflow_runs_and_findings.sql',
  workflow_citations: 'gained finding_id in 20261027000000_workflow_runs_and_findings.sql',
  document_text_layers: 'predates the generated types',
  signing_ceremonies: 'added by 20261026000000_signing_ceremonies.sql',
  ceremony_documents: 'added by 20261026000000_signing_ceremonies.sql',
  asset_funding: 'added by 20261025000000_asset_funding.sql',
}

/** `Database['public']['Tables'][table]['Row']` property names, read from the AST. */
function schemaColumns(): Map<string, Set<string>> {
  const source = ts.createSourceFile(
    generated,
    fs.readFileSync(generated, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const columns = new Map<string, Set<string>>()

  const database = source.statements.find(
    (s): s is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(s) && s.name.text === 'Database',
  )
  if (!database || !ts.isTypeLiteralNode(database.type)) {
    throw new Error('Could not find the generated `Database` type')
  }

  const member = (node: ts.TypeLiteralNode, name: string): ts.TypeLiteralNode | undefined => {
    for (const m of node.members) {
      if (!ts.isPropertySignature(m) || !m.type || !ts.isTypeLiteralNode(m.type)) continue
      const key = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null
      if (key === name) return m.type
    }
    return undefined
  }

  const publicSchema = member(database.type, 'public')
  const tables = publicSchema && member(publicSchema, 'Tables')
  if (!tables) throw new Error('Could not find `public.Tables` in the generated types')

  for (const table of tables.members) {
    if (!ts.isPropertySignature(table) || !table.type || !ts.isTypeLiteralNode(table.type)) continue
    const name =
      ts.isIdentifier(table.name) || ts.isStringLiteral(table.name) ? table.name.text : null
    const row = name ? member(table.type, 'Row') : undefined
    if (!name || !row) continue
    const names = new Set<string>()
    for (const column of row.members) {
      if (!ts.isPropertySignature(column)) continue
      if (ts.isIdentifier(column.name) || ts.isStringLiteral(column.name)) {
        names.add(column.name.text)
      }
    }
    columns.set(name, names)
  }
  return columns
}

/**
 * The offline half of the guard on invented column names.
 *
 * Five features shipped reading `matters.title`, which has never existed, and
 * every unit test passed because each one built its fixture rows from the same
 * wrong assumption. Fixtures cannot catch this; only the schema can.
 */
describe('every column the workbench queries exists in the schema', () => {
  const schema = schemaColumns()
  const { references, embedded } = collectQueryReferences({ roots: WORKBENCH_ROOTS, repoRoot })

  it('finds queries to check', () => {
    // Passing on nothing is how a guard stops guarding without anyone noticing.
    expect(references.length).toBeGreaterThan(100)
    expect(new Set(references.map((r) => r.table)).size).toBeGreaterThan(10)
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
