// Cross-check every column the workbench queries against what the database
// actually has.
//
// The companion to checkDbRpcs.mjs, and here for the same reason: the answer has
// to come from the database, not from anything the repo says about it. The bug
// that prompted it was mine — five features shipped reading `matters.title`, a
// column that has never existed. Every unit test passed, because every one of
// them built its fixture rows from the same wrong assumption.
//
// PostgREST's OpenAPI document lists one definition per table it can resolve,
// with that table's columns as properties. Asking it covers tables the generated
// types have not caught up with yet, which is exactly where the invented column
// hid.
//
// Run: npm run check:db-columns
// Exits 1 when the workbench reads a column the database does not have.

import { existsSync, readFileSync } from 'node:fs'
import { collectQueryReferences, WORKBENCH_ROOTS } from './lib/queryReferences.mjs'

// Standalone node scripts do not get Next.js env loading; read the same files
// Next would, without overriding anything already in the environment.
function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '')
  }
}

async function fetchTableColumns(url, key) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`PostgREST returned HTTP ${response.status}`)
  const spec = await response.json()
  const tables = new Map()
  for (const [name, definition] of Object.entries(spec.definitions ?? {})) {
    tables.set(name, new Set(Object.keys(definition.properties ?? {})))
  }
  return tables
}

loadEnvFile('.env.local')
loadEnvFile('.env')

// SUPABASE_URL is accepted too: the NEXT_PUBLIC_ prefix is meaningless in CI,
// where nothing is being bundled for a browser.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const { references, embedded } = collectQueryReferences({ roots: WORKBENCH_ROOTS })

if (embedded.length > 0) {
  console.error('\n❌ This check cannot read an embedded select, so it would skip its columns:\n')
  for (const site of embedded) console.error(`   • ${site}`)
  console.error('\nTeach scripts/lib/queryReferences.mjs to split embedded selects per table.\n')
  process.exit(1)
}

if (references.length === 0) {
  // Passing on nothing is how a guard stops guarding without anyone noticing.
  console.error('\n❌ Found no queries to check. Did the source directories move?\n')
  process.exit(1)
}

if (!url || !key) {
  // Never fail a build just because credentials are absent — the check is only
  // meaningful where the database is reachable.
  console.log(
    `⊘ Skipping column check (found ${references.length} column reads in source; ` +
      'set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify them)',
  )
  process.exit(0)
}

let tables
try {
  tables = await fetchTableColumns(url, key)
} catch (error) {
  console.error(`\n❌ Could not read the database schema: ${error.message}\n`)
  process.exit(1)
}

const missingTables = []
const missingColumns = []
for (const reference of references) {
  const columns = tables.get(reference.table)
  if (!columns) missingTables.push(reference)
  else if (!columns.has(reference.column)) missingColumns.push(reference)
}

const describe = (r) => `   • ${r.table}.${r.column}\n     ${r.file}:${r.line}`

if (missingTables.length > 0) {
  const names = [...new Set(missingTables.map((r) => r.table))].sort()
  console.error(`\n❌ ${names.length} table${names.length === 1 ? '' : 's'} queried in code but not exposed by the database:\n`)
  for (const name of names) console.error(`   • ${name}`)
  for (const reference of missingTables) console.error(`     ${reference.file}:${reference.line}`)
}

if (missingColumns.length > 0) {
  console.error(
    `\n❌ ${missingColumns.length} column read${missingColumns.length === 1 ? '' : 's'} ` +
      'the database does not have:\n',
  )
  for (const reference of missingColumns) console.error(describe(reference))
  console.error(
    '\nEither the column name is wrong, or its migration has not run. Migration\n' +
      'history is not proof that it did — check the column in the database.\n',
  )
}

if (missingTables.length > 0 || missingColumns.length > 0) process.exit(1)

const tableCount = new Set(references.map((r) => r.table)).size
console.log(
  `✓ All ${references.length} column reads across ${tableCount} tables exist in the database`,
)
