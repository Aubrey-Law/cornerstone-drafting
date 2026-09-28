// Cross-check every column the checked code queries against what the database
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
// One distinction matters, the same one checkDbRpcs.mjs draws for functions: a
// column the database lacks is drift only if nothing in the repo creates it.
// When a migration in this branch creates it, it is just not deployed yet —
// migrations reach the shared database on merge to main — so a pull request
// that adds a column and reads it could otherwise never pass. Such a column
// fails everywhere except on a pull request; one no migration creates (the
// `matters.title` case) fails on every event.
//
// Run: npm run check:db-columns
// Exits 1 when the checked code reads a column the database does not have.

import { existsSync, readFileSync } from 'node:fs'
import { collectQueryReferences, CHECKED_ROOTS } from './lib/queryReferences.mjs'
import { classifyMissingReferences, migrationDefinedSchema } from './lib/migrationSchema.mjs'

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

const { references, embedded } = collectQueryReferences({ roots: CHECKED_ROOTS })

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

const absentTables = []
const absentColumns = []
for (const reference of references) {
  const columns = tables.get(reference.table)
  if (!columns) absentTables.push(reference)
  else if (!columns.has(reference.column)) absentColumns.push(reference)
}

// A pull request is the one place an undeployed migration is expected. Every
// other event — main, the scheduled run, a manual dispatch — is looking at a
// database that should already have everything the repo describes.
const onPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request'
const defined = migrationDefinedSchema()
const tablesSplit = classifyMissingReferences(absentTables.map((r) => ({ ...r, column: undefined, original: r })), defined)
const columnsSplit = classifyMissingReferences(absentColumns, defined)

const missingTables = onPullRequest ? tablesSplit.undefined.map((r) => r.original) : absentTables
const missingColumns = onPullRequest ? columnsSplit.undefined : absentColumns
const pending = onPullRequest
  ? [...tablesSplit.pendingDeploy.map((r) => r.original), ...columnsSplit.pendingDeploy]
  : []

if (pending.length > 0) {
  const names = [...new Set(pending.map((r) => `${r.table}${absentTables.includes(r) ? '' : `.${r.column}`}`))].sort()
  console.log(
    `⏳ ${names.length} table or column read${names.length === 1 ? '' : 's'} created by a migration in this ` +
      'branch and not deployed yet (allowed on a pull request; checked again on main):',
  )
  for (const name of names) console.log(`   • ${name}`)
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
if (pending.length > 0) process.exit(0)

const tableCount = new Set(references.map((r) => r.table)).size
console.log(
  `✓ All ${references.length} column reads across ${tableCount} tables exist in the database`,
)
