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
//   • 20260909000000 was used twice — by `pmps_booking_lead_stage` and then, a
//     day later, by `lead_discovery_stage`. `db push` applies a version once, so
//     the second file's SQL never ran, and every check here stayed green because
//     the version *was* recorded. Applying it by hand stamped 20260910000000 and
//     turned a silent skip into an orphan.
//   • contact_additional_channels was applied by hand minutes before the PR
//     carrying 20260914000000 merged, so the history recorded the same work
//     twice — once under the file's version, once under a wall-clock stamp with
//     no file behind it. The orphan advice pointed at --write-missing, which
//     would have committed the same DDL a second time, numbered behind 40
//     applied migrations. That case is now told apart by name and sent to the
//     repair it actually needs.
//
// Nothing deploys migrations automatically here — Vercel ships code only — so a
// merged migration reaches the database only when someone remembers to run
// `supabase db push`. The scheduled run is what catches the time they don't.
//
// Run: npm run check:migration-drift
// Exits 1 on a duplicate, colliding, orphaned or out-of-order migration always,
// and on a merely pending one when --strict is passed (the scheduled run).
//
// Flags:
//   --strict         also fail on migrations that are merged but not applied
//   --write-missing  materialize an orphan into a file from its recorded SQL.
//                    Skips orphans that only restamp a file already in the repo
//                    (see restampedOrphans) — those need a history repair, and
//                    writing them back would duplicate DDL the repo already has.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MIGRATION_FILE = /^(\d{14})_(.*)\.sql$/
const MIGRATIONS_DIR = 'supabase/migrations'

/** The migration files in `dir`, in the order they would apply. */
export function localMigrations(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  // flatMap rather than map+filter so the result is genuinely a list of
  // objects — `filter(Boolean)` leaves `undefined` in the inferred type.
  return entries
    .flatMap(file => {
      const match = file.match(MIGRATION_FILE)
      return match ? [{ version: match[1], name: match[2], file }] : []
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

/** Versions of the migration files in `dir`, in the order they would apply. */
export function localVersions(dir) {
  return localMigrations(dir).map(migration => migration.version).sort()
}

/**
 * Files that share a version with another file.
 *
 * `db push` applies a version once and records it once, so the loser's SQL
 * never runs — and never will, because the version now reads as applied. That
 * makes a collision invisible to every comparison against the history below,
 * which is why it is checked locally and without credentials.
 */
export function duplicateVersions(migrations) {
  const byVersion = new Map()
  for (const migration of migrations) {
    const files = byVersion.get(migration.version) ?? []
    files.push(migration.file)
    byVersion.set(migration.version, files)
  }
  return [...byVersion]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files: [...files].sort() }))
    .sort((a, b) => (a.version < b.version ? -1 : 1))
}

/**
 * Files whose version is recorded under a different name.
 *
 * The same silent skip as a duplicate, across a merge boundary: the colliding
 * file landed in an earlier PR and is already applied, so a new file reusing
 * its version is recorded as done the moment it merges. It also catches an
 * applied migration being renamed, which the history can no longer match.
 */
export function nameMismatches(migrations, applied) {
  const recorded = new Map(applied.map(row => [row.version, row.name]))
  return migrations
    .filter(migration => {
      const name = recorded.get(migration.version)
      return name !== undefined && name !== migration.name
    })
    .map(migration => ({
      version: migration.version,
      file: migration.file,
      recorded: recorded.get(migration.version),
    }))
}

/**
 * Orphans that are a second stamp of work a file already describes.
 *
 * An orphan has two very different causes, and the remedies are opposites.
 * Usually the repo is what is missing and the recorded SQL should be written
 * back. But when DDL is applied by hand *around* the time its own migration
 * lands, the hand-apply stamps a wall-clock version beside the file's own, and
 * both end up in the history — one recorded under the file's version, one
 * orphaned. Writing that orphan back would add a second file with the same DDL,
 * numbered before every migration merged since, which the out-of-order check
 * would then fail on. The history row is what is wrong there, not the repo.
 *
 * The recorded name is what tells them apart: `supabase db push` and a manual
 * `migration new` both name the row after the migration, so an orphan whose
 * name matches a file sitting at a different version is the same work twice.
 */
export function restampedOrphans(orphaned, applied, migrations) {
  const recorded = new Map(applied.map(row => [row.version, row.name]))
  const byName = new Map(migrations.map(migration => [migration.name, migration]))
  return orphaned.flatMap(version => {
    const name = recorded.get(version)
    const match = name == null ? undefined : byName.get(name)
    if (!match || match.version === version) return []
    return [{ version, name, file: match.file, appliedAs: match.version }]
  })
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
  // Deduped: a version used by two files is one pending migration, not two.
  const pending = [...new Set(local.filter(v => !remoteSet.has(v)))].sort()
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
async function query(ref, token, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!response.ok) {
    throw new Error(`Management API returned HTTP ${response.status}`)
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Management API returned an unexpected shape')
  return rows
}

async function fetchAppliedMigrations(ref, token) {
  const rows = await query(
    ref,
    token,
    'select version, name from supabase_migrations.schema_migrations order by version;',
  )
  return rows.map(row => ({
    version: String(row.version),
    // Pre-CLI rows predate the column; treat a missing name as "unnamed"
    // rather than letting `undefined` masquerade as a mismatch.
    name: row.name == null ? null : String(row.name),
  }))
}

/**
 * Write an orphan back into the repo from the SQL the history recorded.
 *
 * The stock advice for an orphan — `migration repair --status reverted` —
 * discards the record of DDL that is genuinely in the database. That is right
 * only when the version was stamped for something already described by another
 * file. When the DDL is real and simply never had a file (applied out of band,
 * or by an agent with direct database access), the repo is what is missing, and
 * this closes the gap in the direction that keeps the work.
 */
async function writeMissingMigrations(ref, token, orphaned, dir) {
  // Versions come from the history and are matched against /^\d{14}$/ below, so
  // there is nothing here to quote.
  const safe = orphaned.filter(version => /^\d{14}$/.test(version))
  if (safe.length === 0) return []
  const rows = await query(
    ref,
    token,
    'select version, name, statements from supabase_migrations.schema_migrations ' +
      `where version in (${safe.map(version => `'${version}'`).join(', ')}) order by version;`,
  )

  const written = []
  for (const row of rows) {
    const { name, contents } = recoveredMigrationFile(row)
    const file = join(dir, `${row.version}_${name}.sql`)
    if (existsSync(file)) continue
    writeFileSync(file, contents, 'utf8')
    written.push(file)
  }
  return written
}

/** The filename stem and contents for one recovered history row. */
export function recoveredMigrationFile(row) {
  const name = (row.name == null ? '' : String(row.name)).replace(/[^a-z0-9_]/gi, '_')
    || 'recovered_from_history'
  const statements = Array.isArray(row.statements) ? row.statements : []
  const body = statements
    .map(statement => String(statement).trim().replace(/;\s*$/, ''))
    .filter(Boolean)
    .map(statement => `${statement};`)
    .join('\n\n')
  return {
    name,
    contents:
      `-- ${name}\n` +
      '--\n' +
      '-- Recovered from the migration history by `npm run check:migration-drift --\n' +
      '-- --write-missing`. The database recorded this version as applied while no\n' +
      '-- file in this repo described it, so the SQL below is what that version\n' +
      '-- actually ran, in order, rather than a reconstruction.\n' +
      '--\n' +
      '-- Review it before committing: it has to be safe to replay against a fresh\n' +
      '-- database, which is what `supabase db reset --local` will do with it.\n\n' +
      `${body}\n`,
  }
}

async function main() {
  loadEnvFile('.env.local')
  loadEnvFile('.env')

  const strict = process.argv.includes('--strict')
  const writeMissing = process.argv.includes('--write-missing')
  const migrations = localMigrations(MIGRATIONS_DIR)
  const local = migrations.map(migration => migration.version).sort()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(url)

  let failed = false

  // Checked first, and before the credential guard, because a collision is
  // wrong on its own terms: two files cannot both be the same version, and
  // every comparison against the history below reads the loser as applied.
  const duplicates = duplicateVersions(migrations)
  if (duplicates.length > 0) {
    failed = true
    console.error(
      `\n❌ ${duplicates.length} migration version${duplicates.length === 1 ? ' is' : 's are'} ` +
        'used by more than one file:\n',
    )
    for (const { version, files } of duplicates) {
      console.error(`   • ${version}`)
      for (const file of files) console.error(`       ${file}`)
    }
    console.error(
      '\n`db push` applies a version once, so only the first of these ever runs\n' +
        'and the rest are silently skipped — with nothing to notice afterwards,\n' +
        'because the version is recorded. Renumber the file that has not been\n' +
        'applied yet to an unused timestamp:\n' +
        '   git mv supabase/migrations/<version>_<name>.sql \\\n' +
        '          supabase/migrations/<new-version>_<name>.sql\n',
    )
  }

  if (!ref || !token) {
    // Never fail a build just because credentials are absent — the comparison
    // against the history is only meaningful where the history is readable.
    // The local invariants above still stand.
    console.log(
      `⊘ Skipping migration drift check (found ${local.length} migration files; ` +
        'set SUPABASE_ACCESS_TOKEN and SUPABASE_URL to verify them against the database)',
    )
    return failed ? 1 : 0
  }

  let applied
  try {
    applied = await fetchAppliedMigrations(ref, token)
  } catch (error) {
    console.error(`\n❌ Could not read the migration history: ${error.message}\n`)
    return 1
  }

  const remote = applied.map(row => row.version)
  const { pending, orphaned, outOfOrder } = compareMigrations(local, remote)

  const mismatches = nameMismatches(migrations, applied)
  if (mismatches.length > 0) {
    failed = true
    console.error(
      `\n❌ ${mismatches.length} migration file${mismatches.length === 1 ? ' reuses' : 's reuse'} ` +
        'a version the database recorded for something else:\n',
    )
    for (const { version, file, recorded } of mismatches) {
      console.error(`   • ${file} — ${version} is recorded as "${recorded}"`)
    }
    console.error(
      '\nThe version already reads as applied, so this file will never run and\n' +
        'nothing downstream will report it as pending. Renumber it to an unused\n' +
        'timestamp, then apply it with `supabase db push`.\n',
    )
  }

  if (orphaned.length > 0) {
    failed = true
    console.error(
      `\n❌ ${orphaned.length} migration${orphaned.length === 1 ? '' : 's'} recorded in the ` +
        'database with no file in supabase/migrations:\n',
    )
    for (const version of orphaned) {
      const name = applied.find(row => row.version === version)?.name
      console.error(`   • ${version}${name ? ` — ${name}` : ''}`)
    }

    // Split them, because the two shapes take opposite remedies and naming the
    // wrong one is how an orphan turns into a duplicate file.
    const restamped = restampedOrphans(orphaned, applied, migrations)
    const restampedVersions = new Set(restamped.map(row => row.version))
    const unknown = orphaned.filter(version => !restampedVersions.has(version))

    if (restamped.length > 0) {
      console.error(
        `\n${restamped.length === 1 ? 'One of these is' : `${restamped.length} of these are`} ` +
          'already described by a file in the repo, under a different version —\n' +
          'DDL applied by hand beside its own migration, stamping a wall-clock\n' +
          'version alongside the one `db push` recorded:\n',
      )
      for (const { version, file, appliedAs } of restamped) {
        console.error(`   • ${version} — same work as ${file} (recorded as ${appliedAs})`)
      }
      console.error(
        '\nThe repo already has this SQL, so nothing here needs writing back.\n' +
          'Drop the stray history row instead:\n' +
          restamped.map(({ version }) => `   supabase migration repair --status reverted ${version}`).join('\n') +
          '\n\nDo not use --write-missing on these: it would add a second file with the\n' +
          'same DDL, numbered behind every migration merged since.\n',
      )
    }

    if (unknown.length > 0) {
      console.error(
        '\nDDL applied out of band, stamped with its own version, with nothing in\n' +
          'the repo describing it. `supabase db push` refuses to run while this is\n' +
          'present. Bring it back into the repo:\n' +
          '   npm run check:migration-drift -- --write-missing\n' +
          'then review the generated file and commit it.\n',
      )
    }

    if (writeMissing) {
      if (unknown.length === 0) {
        console.error(
          'Nothing to write: every orphan here is a second stamp of a file the repo\n' +
            'already has. Use the repair command above.\n',
        )
      } else {
        try {
          const written = await writeMissingMigrations(ref, token, unknown, MIGRATIONS_DIR)
          if (written.length === 0) {
            console.error('No file was written — every orphan already has one on disk.\n')
          } else {
            console.error(`Wrote ${written.length} migration${written.length === 1 ? '' : 's'} from the recorded history:\n`)
            for (const file of written) console.error(`   • ${file}`)
            console.error('\nReview each one, then commit it. This still exits non-zero:\n' +
              'the drift is only closed once the file is on main.\n')
          }
        } catch (error) {
          console.error(`Could not recover the recorded SQL: ${error.message}\n`)
        }
      }
    }
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
