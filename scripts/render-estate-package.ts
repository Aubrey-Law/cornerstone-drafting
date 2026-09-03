/**
 * Render an estate package from an example payload, standalone:
 *   npm run estate:render -- --package pourover-will
 *   npm run estate:render -- --package joint-trust --example tools/aubreylaw-docgeneration/examples/client-ma-joint-trust.json --out /tmp/render
 *
 * Uses the bundled templates and clauses only (no database lookups), the same
 * code path the app and tests run, so template edits can be exercised and
 * QA-scanned without a matter. Exits non-zero when generation fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { bundledTemplateResolver, generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstateData, NodeEstatePackageName } from '@/lib/estateGenerator/node/types'
import { findExamplePath, listEstatePackageNames } from './estateExamples'


function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const match = argv[i].match(/^--([a-z-]+)$/)
    if (!match) {
      console.error(`Unexpected argument: ${argv[i]}`)
      process.exit(2)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      console.error(`Missing value for --${match[1]}`)
      process.exit(2)
    }
    args[match[1]] = value
    i += 1
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const root = resolveNodeEstateGeneratorRoot()

const packageNames = listEstatePackageNames(root)

const packageName = args.package
if (!packageName || !packageNames.includes(packageName)) {
  console.error(packageName
    ? `Unknown package "${packageName}".`
    : 'Usage: npm run estate:render -- --package <name> [--example <path>] [--state MA] [--out <dir>]')
  console.error(`Available packages:\n  ${packageNames.join('\n  ')}`)
  process.exit(2)
}

function resolveExamplePath(): string {
  if (args.example) return path.resolve(args.example)
  const found = findExamplePath(root, packageName as string)
  if (found) return found
  console.error(`No example payload found for "${packageName}" — pass --example <path>.`)
  process.exit(2)
}

const examplePath = resolveExamplePath()
const state = args.state ?? 'MA'
const outDir = path.resolve(args.out ?? path.join(root, 'output', packageName))

async function main() {
  const data = JSON.parse(fs.readFileSync(examplePath, 'utf8')) as NodeEstateData
  console.log(`Rendering package "${packageName}" (${state}) from ${path.relative(process.cwd(), examplePath)}`)

  const result = await generateNodeEstatePackage({
    data,
    packageName: packageName as NodeEstatePackageName,
    state,
    allowDraft: true,
    // Bundled templates only — skip the DB-backed custom-template lookup.
    // Standalone QA render: bundled templates and the built-in sweep, never
    // the database.
    templateResolver: bundledTemplateResolver,
    styleSet: DEFAULT_STYLE_SET,
  })

  if (!result.ok) {
    console.error(`✗ generation failed (${result.status}): ${result.error}`)
    if (result.missing?.length) console.error(`  missing fields: ${result.missing.join(', ')}`)
    for (const warning of result.warnings ?? []) console.error(`  warning: ${warning}`)
    process.exit(1)
  }

  fs.mkdirSync(outDir, { recursive: true })
  for (const file of result.files) {
    fs.writeFileSync(path.join(outDir, file.name), file.buffer)
    console.log(`  wrote ${path.relative(process.cwd(), path.join(outDir, file.name))} (${file.title})`)
  }
  if (result.missing.length > 0) {
    console.log(`  missing fields (rendered as [[ MISSING: … ]]): ${result.missing.join(', ')}`)
  }
  for (const warning of result.warnings) console.log(`  warning: ${warning}`)
  console.log(`✓ ${result.files.length} file(s) in ${path.relative(process.cwd(), outDir)}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
