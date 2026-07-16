/**
 * Sync the bundled system-workflow tree (tools/workflows/system) into the
 * work_skills table, or validate the tree without touching the database.
 *
 *   npx tsx scripts/syncSystemWorkflows.ts          # validate + sync (needs Supabase env)
 *   npx tsx scripts/syncSystemWorkflows.ts --check  # validate only (CI-safe, no DB)
 */
import { listBundledSystemSkills } from '../lib/works/systemSkills'

async function main() {
  const checkOnly = process.argv.includes('--check')

  const skills = listBundledSystemSkills()
  console.log(`Validated ${skills.length} bundled system skills:`)
  for (const skill of skills) {
    console.log(`  - [${skill.type}] ${skill.slug} (${skill.parsed.metadata.name} v${skill.parsed.metadata.version})`)
  }

  if (checkOnly) {
    console.log('Check-only mode: skipping database sync.')
    return
  }

  const { syncSystemWorkflows } = await import('../lib/works/systemSync')
  const result = await syncSystemWorkflows()
  console.log('Sync complete:', {
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged.length,
    deactivated: result.deactivated,
  })
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
