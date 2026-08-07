// Cross-check the migration files in this repo against the history the
// database actually recorded.
//
// `db-rpc-check.mjs` watches for a symptom — a function the app calls that the
// database cannot resolve. This watches the invariant behind it: every
// migration in the repo should be recorded as applied, and nothing should be
// recorded that has no file behind it. Three separate failures of that
// invariant went unnoticed until they broke something in production:
//
//   • 20260904000000 fixed a unique index so lead opt-in could upsert. It was
//     merged and the code shipped, but nothing ever ran it against the
//     database, so every opt-in save failed with 42P10 for weeks.
//   • Applying that index by hand later stamped a wall-clock version instead of
//     the file's, leaving a history row with no file behind it. `supabase db
//     push` then refused to run at all.
//   • 20260806190324 was a `db pull` snapshot, committed but never repaired
//     into the history. Being older than 30 applied migrations, replaying it
//     would have reverted eight views and four functions to their August state.
//
// Nothing deploys migrations automatically here — Vercel ships code only — so a
// merged migration reaches the database only when someone remembers to run
// `supabase db push`. The scheduled run is what catches the time they don't.
//
// Run: npm run check:migration-drift
// Exits 1 on an orphaned or out-of-order migration always, and on a merely
// pending one when --strict is passed (the scheduled run).

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MIGRATION_FILE = /^(\d{14})_.*\.sql$/

/** Versions of the migration files in `dir`, in the order they would apply. */
export function localVersions(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  // flatMap rather than map+filter so the result is genuinely a list of
  // strings — `filter(Boolean)` leaves `undefined` in the inferred type.
  return entries
    .flatMap(name => {
      const match = name.match(MIGRATION_FILE)
      return match ? [match[1]] : []
    })
    .sort()
}

/**
 * Compare repo versions against recorded ones.
 *
 * `outOfOrder` is the subset of `pending` that sorts before the newest applied
 * migration. Those are the dangerous ones: `db push` applies by version, so
 * replaying one behind newer applied work silently undoes whatever those later
 * migrations changed, and they will not re-run to repair it.
 */
export function compareMigrations(local, remote) {
  const localSet = new Set(local)
  const remoteSet = new Set(remote)
  const pending = local.filter(v => !remoteSet.has(v)).sort()
  const orphaned = remote.filter(v => !localSet.has(v)).sort()
  const newestApplied = remote.length > 0 ? [...remote].sort().at(-1) : null
  const outOfOrder = newestApplied ? pending.filter(v => v < newestApplied) : []
  return { pending, orphaned, outOfOrder }
}

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

/** `https://<ref>.supabase.co` — the ref is already in the URL we have. */
export function projectRefFromUrl(url) {
  return url?.match(/^https?:\/\/([a-z0-9]+)\.supabase\./i)?.[1] ?? null
}

// The history lives in `supabase_migrations`, which PostgREST does not expose,
// so this goes through the Management API rather than the service-role key the
// RPC check uses.
async function fetchAppliedVersions(ref, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'select version from supabase_migrations.schema_migrations order by version;',
    }),
  })
  if (!response.ok) {
    throw new Error(`Management API returned HTTP ${response.status}`)
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Management API returned an unexpected shape')
  return rows.map(row => String(row.version))
}

async function main() {
  loadEnvFile('.env.local')
  loadEnvFile('.env')

  const strict = process.argv.includes('--strict')
  const local = localVersions('supabase/migrations')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(url)

  if (!ref || !token) {
    // Never fail a build just because credentials are absent — the check is only
    // meaningful where the history is readable.
    console.log(
      `⊘ Skipping migration drift check (found ${local.length} migration files; ` +
        'set SUPABASE_ACCESS_TOKEN and SUPABASE_URL to verify them against the database)',
    )
    return 0
  }

  let remote
  try {
    remote = await fetchAppliedVersions(ref, token)
  } catch (error) {
    console.error(`\n❌ Could not read the migration history: ${error.message}\n`)
    return 1
  }

  const { pending, orphaned, outOfOrder } = compareMigrations(local, remote)
  let failed = false

  if (orphaned.length > 0) {
    failed = true
    console.error(
      `\n❌ ${orphaned.length} migration${orphaned.length === 1 ? '' : 's'} recorded in the ` +
        'database with no file in supabase/migrations:\n',
    )
    for (const version of orphaned) console.error(`   • ${version}`)
    console.error(
      '\nUsually DDL applied out of band, stamped with its own version. `supabase db\n' +
        'push` refuses to run while this is present. Clear each one with:\n' +
        '   supabase migration repair --status reverted <version>\n',
    )
  }

  if (outOfOrder.length > 0) {
    failed = true
    console.error(
      `\n❌ ${outOfOrder.length} pending migration${outOfOrder.length === 1 ? ' is' : 's are'} ` +
        'older than migrations already applied:\n',
    )
    for (const version of outOfOrder) console.error(`   • ${version}`)
    console.error(
      '\nApplying these would replay them behind newer work and revert whatever it\n' +
        'changed — the later migrations are already recorded and will not re-run.\n' +
        'If the schema already reflects the file (a `db pull` snapshot does), record\n' +
        'it without executing it:\n' +
        '   supabase migration repair --status applied <version>\n',
    )
  }

  const merelyPending = pending.filter(v => !outOfOrder.includes(v))
  if (merelyPending.length > 0) {
    const label = `${merelyPending.length} migration${merelyPending.length === 1 ? '' : 's'} not yet applied`
    if (strict) {
      failed = true
      console.error(`\n❌ ${label}:\n`)
      for (const version of merelyPending) console.error(`   • ${version}`)
      console.error(
        '\nThe repo and the database disagree. Nothing applies migrations here on\n' +
          'merge, so this is how a shipped feature ends up running against a schema\n' +
          'that never got its change. Apply them with `supabase db push`.\n',
      )
    } else {
      // On a pull request an unapplied migration is the normal state — it is
      // supposed to land at merge, not before. Only the scheduled run treats it
      // as drift.
      console.log(`⚠ ${label} (expected on a branch; the scheduled run enforces this):`)
      for (const version of merelyPending) console.log(`   • ${version}`)
    }
  }

  if (!failed) {
    console.log(
      `✓ Migration history matches the repo (${remote.length} applied, ` +
        `${merelyPending.length} pending)`,
    )
  }
  return failed ? 1 : 0
}

// Importable for tests; only runs the check when invoked directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
