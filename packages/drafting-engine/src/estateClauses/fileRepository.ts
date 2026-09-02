import fs from 'node:fs'
import path from 'node:path'
import { runtimeReadonlyMap } from './repository'
import type {
  EstateClauseSnapshot,
  EstateDocumentType,
  PublishedEstateClause,
} from './types'
import { hashEstateClauseContent } from './validation'
import { resolveNodeEstateGeneratorRoot } from '../estateGenerator/node/config'

interface BundledClauseJson {
  id?: string
  title?: string
  document_type?: EstateDocumentType
  jurisdiction?: string
  condition?: string | null
  required_fields?: string[]
  nested_clause_keys?: string[]
  review_status?: string
  text?: string
}

export interface LoadBundledEstateClauseSnapshotArgs {
  root?: string
  jurisdiction: string
  allowDraft?: boolean
}

function walkJsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkJsonFiles(entryPath))
    else if (entry.name.endsWith('.json')) files.push(entryPath)
  }
  return files.sort()
}

function nestedClauseKeys(clause: BundledClauseJson): string[] {
  if (clause.nested_clause_keys) return [...clause.nested_clause_keys]
  const keys = new Set<string>()
  const pattern = /include_clause\(\s*(['"])([A-Za-z0-9._-]+)\1(?:\s*,\s*['"][A-Za-z0-9_-]+['"])?\s*\)/g
  for (const match of clause.text?.matchAll(pattern) ?? []) keys.add(match[2])
  return [...keys]
}

function loadDirectory(args: {
  root: string
  directory: string
  warnings: string[]
}): Map<string, PublishedEstateClause> {
  const clauses = new Map<string, PublishedEstateClause>()
  for (const filePath of walkJsonFiles(args.directory)) {
    const source = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BundledClauseJson
    if (!source.id) {
      args.warnings.push(`Clause file has no id and was ignored: ${filePath}`)
      continue
    }
    const reviewStatus = source.review_status ?? 'draft'
    if (!source.title || !source.document_type || typeof source.text !== 'string') {
      throw new Error(`Bundled clause ${source.id} is missing required publication metadata`)
    }
    const content = {
      text: source.text,
      requiredFields: Object.freeze([...(source.required_fields ?? [])]),
      nestedClauseKeys: Object.freeze(nestedClauseKeys(source)),
      conditionField: source.condition ?? null,
    }
    const contentHash = hashEstateClauseContent(content)
    const publication = Object.freeze({
      clauseId: source.id,
      clauseKey: source.id,
      title: source.title,
      jurisdiction: 'MA' as const,
      documentTypes: Object.freeze([source.document_type]),
      revisionId: `file:${contentHash}`,
      revisionNumber: 0,
      contentHash,
      reviewStatus,
      sourceFile: path.relative(args.root, filePath),
      sourceJurisdiction: source.jurisdiction ?? 'base',
      ...content,
    })
    clauses.set(source.id, publication)
  }
  return clauses
}

export function loadBundledEstateClauseSnapshot({
  root = resolveNodeEstateGeneratorRoot(),
  jurisdiction,
  allowDraft = false,
}: LoadBundledEstateClauseSnapshotArgs): EstateClauseSnapshot {
  const warnings: string[] = []
  if (jurisdiction !== 'MA') {
    warnings.push(`Estate clause metadata is currently maintained for MA only; rendering state ${jurisdiction} with MA clauses.`)
  }
  const winners = loadDirectory({ root, directory: path.join(root, 'clauses'), warnings })
  const stateClauses = loadDirectory({
    root,
    directory: path.join(root, 'states', jurisdiction, 'clauses'),
    warnings,
  })
  for (const [key, clause] of stateClauses) winners.set(key, clause)

  const clauses = new Map<string, PublishedEstateClause>()
  const unavailableClauses = new Map<string, {
    clauseKey: string
    reviewStatus: string
    sourceFile?: string
  }>()
  for (const [key, clause] of winners) {
    if (clause.reviewStatus === 'approved' || allowDraft) clauses.set(key, clause)
    else unavailableClauses.set(key, Object.freeze({
      clauseKey: key,
      reviewStatus: clause.reviewStatus,
      sourceFile: clause.sourceFile,
    }))
  }

  return Object.freeze({
    jurisdiction: 'MA' as const,
    clauses: runtimeReadonlyMap(clauses),
    overrides: runtimeReadonlyMap(new Map()),
    source: 'file' as const,
    warnings: Object.freeze(warnings),
    unavailableClauses: runtimeReadonlyMap(unavailableClauses),
  })
}
