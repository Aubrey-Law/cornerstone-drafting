import { spawnSync } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'
import { projectRefFromUrl } from './checkMigrationDrift.mjs'

/**
 * Regenerate packages/db-types/src/supabase.generated.ts from the hosted project.
 *
 * Addressed by project ref rather than by `supabase link`. Linking is not a
 * read of the schema: it writes local state and reads project settings and API
 * keys, which needs privileges that reading the schema does not. On 2026-09-15
 * that difference took the whole check out — `supabase link` returned
 *
 *     Authorization failed for the access token and project ref pair:
 *     "Your account does not have the necessary privileges to access this endpoint."
 *
 * on a token that was, on the same schedule, successfully reading the migration
 * history through the Management API. The drift check never reached type
 * generation, so it reported a failure that looked like drift and was not, and
 * nothing was compared at all.
 *
 * `gen types --project-id` needs only SUPABASE_ACCESS_TOKEN, so nothing here
 * depends on a privilege it does not use.
 */

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(url)

if (!ref) {
  console.error(
    'Could not determine the Supabase project ref. Set SUPABASE_PROJECT_REF, or '
      + 'SUPABASE_URL to https://<ref>.supabase.co.',
  )
  process.exit(1)
}
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is required to read the schema from the hosted project.')
  process.exit(1)
}

const outputPath = 'packages/db-types/src/supabase.generated.ts'
const temporaryPath = `${outputPath}.tmp`
const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', '--project-id', ref, '--schema', 'public'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)

if (result.status !== 0) process.exit(result.status ?? 1)
if (!result.stdout.includes('export type Database')) {
  console.error('Supabase type generation returned incomplete output; existing types were preserved.')
  process.exit(1)
}

writeFileSync(temporaryPath, result.stdout)
renameSync(temporaryPath, outputPath)
console.log(`Wrote ${outputPath}`)
