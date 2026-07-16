import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  importBundledEstateClauses,
  type BundledEstateClause,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateDocumentType } from '@/lib/estateClauses/types'

const DOCUMENT_TYPES = new Set<EstateDocumentType>([
  'will',
  'trust',
  'durable_power_of_attorney',
  'health_care_directive',
  'hipaa_authorization',
  'ancillary',
])

function isBundledEstateClause(value: unknown): value is BundledEstateClause {
  if (!value || typeof value !== 'object') return false
  const clause = value as Record<string, unknown>
  return typeof clause.id === 'string'
    && typeof clause.title === 'string'
    && typeof clause.text === 'string'
    && typeof clause.jurisdiction === 'string'
    && typeof clause.document_type === 'string'
    && DOCUMENT_TYPES.has(clause.document_type as EstateDocumentType)
    && (clause.required_fields === undefined || (
      Array.isArray(clause.required_fields)
      && clause.required_fields.every(field => typeof field === 'string')
    ))
}

async function readClauseDirectory(directory: string): Promise<BundledEstateClause[]> {
  const filenames = (await readdir(directory))
    .filter(filename => filename.endsWith('.json'))
    .sort()
  return Promise.all(filenames.map(async filename => {
    const filePath = path.join(directory, filename)
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isBundledEstateClause(parsed)) {
      throw new Error(`Invalid bundled estate clause: ${filePath}`)
    }
    return parsed
  }))
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')
  const bundledClauses = [
    ...await readClauseDirectory(path.join(root, 'clauses')),
    ...await readClauseDirectory(path.join(root, 'states/MA/clauses')),
  ]
  const actorId = process.env.ESTATE_CLAUSE_IMPORT_ACTOR_ID ?? ''
  if (!dryRun && !actorId) {
    throw new Error('ESTATE_CLAUSE_IMPORT_ACTOR_ID is required unless --dry-run is used')
  }

  const result = await importBundledEstateClauses({
    client: dryRun ? undefined : getAdminClient() as unknown as EstateClauseClient,
    actorId,
    dryRun,
    bundledClauses,
  })
  const includesStateSpecificAffidavit = bundledClauses.some(clause => (
    clause.id === 'execution.self_proving_affidavit' && clause.jurisdiction === 'MA'
  ))

  console.log(`bundled=${bundledClauses.length}`)
  console.log(`includesStateSpecificAffidavit=${includesStateSpecificAffidavit}`)
  console.log(`created=${result.created}`)
  console.log(`unchanged=${result.unchanged}`)
  console.log(`requiresReview=${result.requiresReview}`)
  console.log(`conflicts=${result.conflicts}`)
  for (const message of result.messages) console.log(`conflict=${message}`)
  console.log('publications=0')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
