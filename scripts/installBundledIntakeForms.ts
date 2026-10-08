/**
 * Default: inspect and print a read-only installation plan.
 * Writes: npm run intake:forms:install -- --apply --actor-id <administrator UUID>
 * Every write uses the administrator lifecycle service; a drifted or incomplete
 * existing installation requires explicit review, never an automatic new version.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'
import { COLLEGE_PREP_INTAKE_FORM, ESTATE_INTAKE_FORM } from '../lib/intake/forms/definitions'
import { compileIntakeForm } from '../lib/intake/forms/compiler'
import { canonicalizeIntakeFormDefinition, hashIntakeFormDefinition } from '../lib/intake/forms/hash'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from '../lib/intake/forms/persistenceTypes'
import type { IntakeFormDefinition } from '../lib/intake/forms/types'

export interface ExistingBundledIntakeForm {
  template: IntakeFormTemplateRow
  versions: IntakeFormVersionRow[]
}
export interface BundledIntakeFormInstallStep {
  key: 'estate' | 'college_prep'
  definition: IntakeFormDefinition
  definitionHash: string
  action: 'create_and_publish' | 'noop'
}
export interface BundledIntakeFormInstallOptions { apply: boolean; actorId?: string }

class BundledIntakeFormInstallError extends Error {}
const inconsistent = () => new BundledIntakeFormInstallError('Bundled form installation state is inconsistent; review it explicitly before installing')

/** Pure: compile both code-owned fixtures, then inspect a complete persisted snapshot. */
export function buildBundledIntakeFormInstallPlan(existing: readonly ExistingBundledIntakeForm[]): BundledIntakeFormInstallStep[] {
  const candidates = ([ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM] as const).map((raw) => {
    for (const audience of ['client', 'staff'] as const) {
      const result = compileIntakeForm(raw, audience)
      if (!result.success) throw new BundledIntakeFormInstallError(`Invalid bundled intake form ${raw.key} for ${audience}`)
    }
    const definition = canonicalizeIntakeFormDefinition(raw)
    return { key: raw.key as 'estate' | 'college_prep', definition, definitionHash: hashIntakeFormDefinition(definition) }
  })

  return candidates.map((candidate) => {
    const matches = existing.filter(({ template }) => template.key === candidate.key)
    if (!matches.length) return { ...candidate, action: 'create_and_publish' }
    if (matches.length !== 1) throw inconsistent()
    const { template, versions } = matches[0]
    if (versions.some((version) => version.status === 'published' && version.definition_hash !== candidate.definitionHash)) {
      throw new BundledIntakeFormInstallError('Published bundled form differs; create and review a new draft explicitly')
    }
    const version = versions[0]
    if (template.archived_at !== null || versions.length !== 1 || !version || version.status !== 'published'
      || version.version !== 1 || version.template_id !== template.id || version.definition.key !== candidate.key
      || version.published_at === null || version.published_by === null) throw inconsistent()
    try {
      if (hashIntakeFormDefinition(version.definition) !== candidate.definitionHash) throw inconsistent()
    } catch { throw inconsistent() }
    return { ...candidate, action: 'noop' }
  })
}

function validateOptions(options: BundledIntakeFormInstallOptions): void {
  if (options.apply && options.actorId === undefined) {
    throw new BundledIntakeFormInstallError('Apply requires an explicit UUID --actor-id')
  }
  if (options.actorId !== undefined && !z.string().uuid().safeParse(options.actorId).success) {
    throw new BundledIntakeFormInstallError('actor-id must be a UUID')
  }
}

export function parseBundledIntakeFormInstallArgs(args: readonly string[]): BundledIntakeFormInstallOptions {
  const seen = new Set<string>()
  const options: BundledIntakeFormInstallOptions = { apply: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!['--dry-run', '--apply', '--actor-id'].includes(arg)) throw new BundledIntakeFormInstallError('Unknown installer argument')
    if (seen.has(arg)) throw new BundledIntakeFormInstallError('Duplicate installer argument')
    seen.add(arg)
    if (arg === '--apply') options.apply = true
    if (arg === '--actor-id') {
      options.actorId = args[++i] ?? ''
    }
  }
  if (seen.has('--dry-run') && seen.has('--apply')) throw new BundledIntakeFormInstallError('Choose either --dry-run or --apply')
  validateOptions(options)
  return options
}

export async function runBundledIntakeFormInstall(options: BundledIntakeFormInstallOptions): Promise<BundledIntakeFormInstallStep[]> {
  validateOptions(options)
  // Validate both bundles before importing a persistence module or making a DB call.
  buildBundledIntakeFormInstallPlan([])
  const service = await import('../lib/intake/forms/adminService')
  const templates = await service.listIntakeFormTemplates()
  const existing = await Promise.all(templates.filter(({ key }) => key === 'estate' || key === 'college_prep')
    .map(async (template) => ({ template, versions: await service.listIntakeFormVersions(template.id) })))
  // Build the entire plan before the first mutation, including the second key.
  const plan = buildBundledIntakeFormInstallPlan(existing)
  if (!options.apply) return plan
  for (const step of plan) {
    if (step.action === 'noop') continue
    const { draft } = await service.createIntakeFormTemplate({
      key: step.key, name: step.definition.title, description: step.definition.description ?? null,
      definition: step.definition, actorId: options.actorId!,
    })
    await service.publishIntakeFormDraft({
      versionId: draft.id, expectedLockVersion: draft.lock_version,
      expectedDefinitionHash: step.definitionHash, actorId: options.actorId!,
    })
  }
  return plan
}

async function main(): Promise<void> {
  const options = parseBundledIntakeFormInstallArgs(process.argv.slice(2))
  config({ path: '.env.local', quiet: true })
  const plan = await runBundledIntakeFormInstall(options)
  console.log(options.apply ? 'Apply complete:' : 'Dry-run (no writes):')
  for (const { key, definitionHash, action } of plan) console.log(`${key} ${definitionHash} ${action}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Raw provider errors can include sensitive configuration; never print them.
    console.error(error instanceof BundledIntakeFormInstallError ? error.message : 'Bundled form installation failed; check server configuration and administrator access. Review any existing drafts explicitly.')
    process.exitCode = 1
  })
}
