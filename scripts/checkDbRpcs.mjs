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
// One distinction matters, because the two look identical to a naive check:
// an RPC missing from the database is drift only if nothing in the repo defines
// it. When a migration in this branch creates it, the function is simply not
// deployed yet — migrations reach the shared database on merge to main, so a
// pull request that adds an RPC would otherwise fail a required check it could
// never pass before merging.
//
// So a missing RPC no repo migration defines fails on every event, and one a
// migration does define fails everywhere except on a pull request. The drift
// this file exists to catch is unaffected: `update_lead_opportunity_field` was
// defined by a migration whose SQL never ran, and the daily scheduled run —
// which the header above calls the important one — still fails on it.
//
// Run: npm run check:db-rpcs
// Exits 1 when the app calls an RPC the database does not expose.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The app's own directories.
const SOURCE_DIRS = [
  'app',
  'lib',
  'components',
  // The matters MCP server. Not part of either app, and its one RPC
  // (`correct_matter`) is the only write path an agent has into matters — so
  // an unverified call here is the failure this script exists to catch.
  'tools/matters-mcp/src',
]
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

const MIGRATIONS_DIR = 'supabase/migrations'
const FUNCTION_DEFINITION_PATTERN =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z0-9_]+)/gi

/**
 * Every function name any migration in the repo creates.
 *
 * Read from the files rather than from migration history: history says what was
 * *applied*, and a migration in an unmerged branch has no history row at all —
 * which is exactly the case this needs to recognize.
 *
 * @returns {Set<string>}
 */
export function migrationDefinedRpcs(dir = MIGRATIONS_DIR) {
  const defined = new Set()
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return defined
  }
  for (const name of entries) {
    if (!name.endsWith('.sql')) continue
    const sql = readFileSync(join(dir, name), 'utf8')
    for (const match of sql.matchAll(FUNCTION_DEFINITION_PATTERN)) defined.add(match[1])
  }
  return defined
}

/**
 * Split RPCs missing from the database into the two cases that need different
 * answers.
 *
 * `undefined` is a real bug in any context: code calls a function nothing in
 * the repo or the database defines. `pendingDeploy` is a migration that has not
 * landed yet, which is normal on a pull request and a genuine problem anywhere
 * else.
 *
 * @returns {{ undefined: string[], pendingDeploy: string[] }}
 */
export function classifyMissingRpcs(missing, definedInMigrations) {
  const result = { undefined: [], pendingDeploy: [] }
  for (const name of missing) {
    if (definedInMigrations.has(name)) result.pendingDeploy.push(name)
    else result.undefined.push(name)
  }
  return result
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
/**
 * Entry point. Separated from the exported helpers above so the test suite can
 * import and exercise them without the script running against a database —
 * the same shape checkMigrationDrift.mjs uses.
 */
async function main() {
  loadEnvFile('.env.local')
  loadEnvFile('.env')

  // SUPABASE_URL is accepted too: the NEXT_PUBLIC_ prefix is meaningless in CI,
  // where nothing is being bundled for a browser.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  const called = collectCalledRpcs()

  if (!url || !key) {
    // Never fail a build just because credentials are absent — the check is only
    // meaningful where the database is reachable.
    console.log(
      `⊘ Skipping RPC check (found ${called.size} RPC calls in source; ` +
        'set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify them)',
    )
    return 0
  }

  let exposed
  try {
    exposed = await fetchExposedRpcs(url, key)
  } catch (error) {
    console.error(`\n❌ Could not read the database schema: ${error.message}\n`)
    return 1
  }

  const missing = [...called.keys()].filter(name => !exposed.has(name)).sort()
  const { undefined: undefinedRpcs, pendingDeploy } = classifyMissingRpcs(
    missing,
    migrationDefinedRpcs(),
  )

  // A pull request is the one place an undeployed migration is expected. Every
  // other event — main, the scheduled run, a manual dispatch — is looking at a
  // database that should already have everything the repo describes.
  const onPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request'

  function reportSites(name) {
    for (const site of called.get(name)) console.error(`     ${site}`)
  }

  if (undefinedRpcs.length > 0) {
    console.error(
      `\n❌ ${undefinedRpcs.length} RPC${undefinedRpcs.length === 1 ? '' : 's'} called in code ` +
        'but neither exposed by the database nor created by any migration:\n',
    )
    for (const name of undefinedRpcs) {
      console.error(`   • ${name}`)
      reportSites(name)
    }
    console.error(
      '\nNothing in this repository defines these. Either the call name is wrong or\n' +
        'the migration that should create them was never written.\n',
    )
  }

  if (pendingDeploy.length > 0 && !onPullRequest) {
    console.error(
      `\n❌ ${pendingDeploy.length} RPC${pendingDeploy.length === 1 ? '' : 's'} created by a ` +
        'migration in this repository but not exposed by the database:\n',
    )
    for (const name of pendingDeploy) {
      console.error(`   • ${name}`)
      reportSites(name)
    }
    console.error(
      '\nThe function is missing or not in PostgREST’s schema cache. Check whether\n' +
        'its migration truly ran (a history row can exist without its SQL having\n' +
        'executed), then re-apply it and reload the schema cache.\n',
    )
  }

  if (undefinedRpcs.length > 0 || (pendingDeploy.length > 0 && !onPullRequest)) {
    return 1
  }

  if (pendingDeploy.length > 0) {
    // Not a failure here, and said plainly so nobody reads it as the drift
    // failure above: these deploy when the branch merges.
    console.log(
      `\n⏳ ${pendingDeploy.length} RPC${pendingDeploy.length === 1 ? ' is' : 's are'} new in ` +
        'this branch and not deployed yet:\n',
    )
    for (const name of pendingDeploy) console.log(`   • ${name}`)
    console.log(
      '\nA migration here creates them, and migrations reach the shared database\n' +
        'when this merges. The scheduled run will fail on them if it does not.\n',
    )
    // Reported, not failed — but the summary below must not then claim
    // everything is exposed, because it is not.
    console.log(`✓ The other ${called.size - pendingDeploy.length} RPCs are exposed by the database`)
    return 0
  }

  console.log(`✓ All ${called.size} RPCs called in app code are exposed by the database`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
