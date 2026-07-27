// Cross-check every Supabase RPC the app calls against what the database
// actually exposes.
//
// Migration history is not proof: `supabase_migrations.schema_migrations` can
// list a migration as applied when its body never executed. That is how
// `update_lead_opportunity_field` went missing while the history claimed
// otherwise — every inline lead edit failed with PGRST202 in production, and
// `supabase db push` skipped the migration because the history said it was done.
//
// So this asks the layer that actually failed: PostgREST's OpenAPI document
// lists one /rpc/<name> path per function it can resolve for the given role.
//
// Run: npm run check:db-rpcs
// Exits 1 when the app calls an RPC the database does not expose.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const SOURCE_DIRS = ['app', 'lib', 'components']
const SOURCE_EXTS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build'])
const RPC_PATTERN = /\.rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]/g

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

function sourceFiles(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (SOURCE_EXTS.has(extname(entry.name))) found.push(path)
  }
  return found
}

/** @returns {Map<string, string[]>} rpc name -> call sites (`file:line`) */
function collectCalledRpcs() {
  const calls = new Map()
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(RPC_PATTERN)) {
        const line = content.slice(0, match.index).split('\n').length
        const sites = calls.get(match[1]) ?? []
        sites.push(`${file}:${line}`)
        calls.set(match[1], sites)
      }
    }
  }
  return calls
}

async function fetchExposedRpcs(url, key) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok) {
    throw new Error(`PostgREST returned HTTP ${response.status}`)
  }
  const spec = await response.json()
  return new Set(
    Object.keys(spec.paths ?? {})
      .filter(path => path.startsWith('/rpc/'))
      .map(path => path.slice('/rpc/'.length)),
  )
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const called = collectCalledRpcs()

if (!url || !key) {
  // Never fail a build just because credentials are absent — the check is only
  // meaningful where the database is reachable.
  console.log(
    `⊘ Skipping RPC check (found ${called.size} RPC calls in source; ` +
      'set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify them)',
  )
  process.exit(0)
}

let exposed
try {
  exposed = await fetchExposedRpcs(url, key)
} catch (error) {
  console.error(`\n❌ Could not read the database schema: ${error.message}\n`)
  process.exit(1)
}

const missing = [...called.keys()].filter(name => !exposed.has(name)).sort()

if (missing.length > 0) {
  console.error(
    `\n❌ ${missing.length} RPC${missing.length === 1 ? '' : 's'} called in code ` +
      'but not exposed by the database:\n',
  )
  for (const name of missing) {
    console.error(`   • ${name}`)
    for (const site of called.get(name)) console.error(`     ${site}`)
  }
  console.error(
    '\nThe function is missing or not in PostgREST’s schema cache. Check whether\n' +
      'its migration truly ran (a history row can exist without its SQL having\n' +
      'executed), then re-apply it and reload the schema cache.\n',
  )
  process.exit(1)
}

console.log(`✓ All ${called.size} RPCs called in app code are exposed by the database`)
