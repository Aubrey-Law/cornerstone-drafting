import fs from 'node:fs'
import path from 'node:path'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstateContext } from '@/lib/estateGenerator/node/types'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { isPresent, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

interface ClauseJson {
  id?: string
  title?: string
  jurisdiction?: string
  condition?: string | null
  required_fields?: string[]
  review_status?: string
  text?: string
  _source_file?: string
}

interface IncludedClause {
  id: string
  title?: string
  jurisdiction?: string
  source?: string
  review_status: string
}

interface SkippedClause {
  id: string
  reason: string
  source?: string
}

export interface NodeClauseReport {
  included_clauses: IncludedClause[]
  skipped_clauses: SkippedClause[]
  missing_fields: string[]
  warnings: string[]
}

export interface NodeClauseStore {
  report: NodeClauseReport
  include: (clauseId: string, context: NodeEstateContext, lookupState?: string) => string
}

interface CreateNodeClauseStoreOptions {
  root?: string
  state: string
  allowDraft?: boolean
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function walkJsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []

  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(entryPath))
    } else if (entry.name.endsWith('.json')) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

function loadClauseDir(root: string, directory: string, report: NodeClauseReport): Map<string, ClauseJson> {
  const clauses = new Map<string, ClauseJson>()

  for (const filePath of walkJsonFiles(directory)) {
    const clause = readJsonFile<ClauseJson>(filePath)
    if (!clause.id) {
      report.warnings.push(`Clause file has no id and was ignored: ${filePath}`)
      continue
    }
    clause._source_file = path.relative(root, filePath)
    clauses.set(clause.id, clause)
  }

  return clauses
}

export function createNodeClauseStore({
  root = resolveNodeEstateGeneratorRoot(),
  state,
  allowDraft = false,
}: CreateNodeClauseStoreOptions): NodeClauseStore {
  const report: NodeClauseReport = {
    included_clauses: [],
    skipped_clauses: [],
    missing_fields: [],
    warnings: [],
  }
  const baseClauses = loadClauseDir(root, path.join(root, 'clauses'), report)
  const stateClauses = loadClauseDir(root, path.join(root, 'states', state, 'clauses'), report)

  function getClause(clauseId: string): ClauseJson {
    const clause = stateClauses.get(clauseId) ?? baseClauses.get(clauseId)
    if (!clause) throw new Error(`Clause not found: ${clauseId}`)
    return clause
  }

  function include(clauseId: string, context: NodeEstateContext, lookupState = state): string {
    if (lookupState !== state) {
      report.warnings.push(`Requested clause ${clauseId} for state ${lookupState}; active state is ${state}.`)
    }

    const clause = getClause(clauseId)
    const condition = clause.condition
    if (condition && !isPresent(context[condition])) {
      report.skipped_clauses.push({
        id: clauseId,
        reason: `condition false: ${condition}`,
        source: clause._source_file,
      })
      return ''
    }

    const reviewStatus = clause.review_status ?? 'draft'
    if (reviewStatus !== 'approved' && !allowDraft) {
      throw new Error(`Clause ${clauseId} is marked ${JSON.stringify(reviewStatus)}. Use allowDraft to generate draft documents.`)
    }

    // Record missing required fields but still render the clause — empty values
    // surface as visible `[[ MISSING: field ]]` markers so the draft always
    // renders with its holes loud rather than failing the whole document.
    const missing = missingRequiredFields(context, clause.required_fields ?? [])
    if (missing.length > 0) {
      report.missing_fields.push(...missing)
    }

    report.included_clauses.push({
      id: clauseId,
      title: clause.title,
      jurisdiction: clause.jurisdiction,
      source: clause._source_file,
      review_status: reviewStatus,
    })

    return renderNodeEstateText(clause.text ?? '', context, {
      include_clause: (nestedClauseId: string, nestedState?: string) => include(nestedClauseId, context, nestedState),
    })
  }

  return { report, include }
}
