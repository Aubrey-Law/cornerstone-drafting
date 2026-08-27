/**
 * Put the built-in style sets into the style_sets table.
 *
 *   npx tsx scripts/seedStyleSets.ts          # validate + seed (needs Supabase env)
 *   npx tsx scripts/seedStyleSets.ts --check  # validate only (CI-safe, no DB)
 *
 * Seeding creates rows to look at. It marks no default, so generated documents
 * keep rendering exactly as they do now until somebody chooses a style set in
 * Settings → Style sets. Re-running is safe: an existing row is never
 * overwritten, so edits to the house style survive.
 */
import { BUILT_IN_STYLE_SETS } from '../lib/styleSets/defaults'
import { countOverrides, describeStyleSet } from '../lib/styleSets/editorFields'

async function main() {
  const checkOnly = process.argv.includes('--check')

  console.log(`Validated ${Object.keys(BUILT_IN_STYLE_SETS).length} built-in style sets:`)
  for (const [id, settings] of Object.entries(BUILT_IN_STYLE_SETS)) {
    const overrides = countOverrides(settings)
    console.log(
      `  - ${id}: ${overrides} override${overrides === 1 ? '' : 's'}` +
        `${describeStyleSet(settings) ? ` (${describeStyleSet(settings)})` : ''}`,
    )
  }

  if (checkOnly) {
    console.log('Check-only mode: skipping database seed.')
    return
  }

  const { seedStyleSets } = await import('../lib/styleSets/seed')
  const result = await seedStyleSets()

  console.log('Seed complete:', {
    created: result.created,
    unchanged: result.unchanged,
    preserved: result.preserved,
  })

  if (result.created.length > 0) {
    console.log(
      '\nNothing is applied yet. Open Settings → Style sets to review one and, if it is right,\n' +
        'use "Make default" — that is the step that changes generated documents.',
    )
  }
  if (result.preserved.length > 0) {
    console.log(
      `\nLeft alone because they have been edited since seeding: ${result.preserved.join(', ')}.`,
    )
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
