/** Read-only catalog preflight. Does not activate pinning or verify deployment/providers. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { compileIntakeForm } from '../lib/intake/forms/compiler'
import { hashIntakeFormDefinition } from '../lib/intake/forms/hash'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from '../lib/intake/forms/persistenceTypes'

const tracks = ['estate', 'college_prep'] as const
type Track = typeof tracks[number]
export interface ReleaseCatalog {
  getTemplateRowByKey(key: string): Promise<IntakeFormTemplateRow | null>
  listVersionRows(templateId: string): Promise<IntakeFormVersionRow[]>
}
export class IntakeReleaseCheckError extends Error {}

export async function checkIntakeFormRelease(catalog: ReleaseCatalog) {
  return Promise.all(tracks.map(async (track: Track) => {
    const reject = (reason: string): never => { throw new IntakeReleaseCheckError(`${track}: ${reason}`) }
    const template = await catalog.getTemplateRowByKey(track)
    if (!template || template.key !== track || template.archived_at !== null
      || (template.purpose ?? 'client_intake') !== 'client_intake') {
      return reject('active client-intake template required')
    }
    const versions = await catalog.listVersionRows(template.id)
    // Match the database assignment rule, independent of repository sort order.
    const version = versions.filter(row => row.status === 'published').sort((a, b) => b.version - a.version)[0]
    if (!version) return reject('published version required')
    if (version.template_id !== template.id || version.definition.key !== track
      || (version.definition.purpose ?? 'client_intake') !== 'client_intake'
      || !version.published_at || !version.published_by) return reject('published version metadata is inconsistent')
    let hash: string
    try { hash = hashIntakeFormDefinition(version.definition) }
    catch { return reject('published definition is invalid') }
    if (hash !== version.definition_hash) return reject('published definition hash does not match')
    for (const audience of ['client', 'staff'] as const) {
      if (!compileIntakeForm(version.definition, audience).success) return reject(`published definition does not compile for ${audience}`)
    }
    return { track, templateId: template.id, versionId: version.id, version: version.version, definitionHash: hash }
  }))
}

async function main() {
  if (process.argv.length > 2) throw new IntakeReleaseCheckError('This read-only command accepts no arguments')
  config({ path: '.env.local', quiet: true })
  const repository = await import('../lib/intake/forms/repository')
  const result = await checkIntakeFormRelease(repository)
  console.log('Catalog preflight passed (read-only snapshot; no activation).')
  console.log(JSON.stringify(result, null, 2))
  console.log('Still required: deployed pin-aware code, schema/rollout verification, provider-backed uploads, and database-owner activation review. Recheck these IDs/hashes immediately before activation.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof IntakeReleaseCheckError ? error.message : 'Catalog preflight failed; check server configuration and stored catalog integrity.')
    process.exitCode = 1
  })
}
