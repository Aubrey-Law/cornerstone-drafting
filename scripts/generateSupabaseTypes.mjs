import { spawnSync } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'

const outputPath = 'types/supabase.generated.ts'
const temporaryPath = `${outputPath}.tmp`
const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', '--linked', '--schema', 'public'],
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
