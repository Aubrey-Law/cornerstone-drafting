import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import type { EstateClauseSnapshot, EstateDocumentType, PublishedEstateClause } from '@/lib/estateClauses/types'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import type { NodeEstateContext } from '@/lib/estateGenerator/node/types'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { isPresent, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

interface IncludedClause {
  id: string
  clause_id: string
  clause_key: string
  revision_id: string
  content_hash: string
  title?: string
  jurisdiction?: string
  source?: string
  review_status: string
  selection_reason: 'template_rule' | 'attorney_override'
  override_id: string | null
}

interface SkippedClause {
  id: string
  reason: string
  source?: string
  selection_reason?: 'attorney_override'
  override_id?: string
  clause_id?: string
  clause_key?: string
  revision_id?: string
  content_hash?: string
  override_action?: 'force_omit'
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
  snapshot?: EstateClauseSnapshot
  documentTypes?: readonly EstateDocumentType[]
}

export function createNodeClauseStore({
  root = resolveNodeEstateGeneratorRoot(),
  state,
  allowDraft = false,
  snapshot = loadBundledEstateClauseSnapshot({ root, jurisdiction: state, allowDraft }),
  documentTypes,
}: CreateNodeClauseStoreOptions): NodeClauseStore {
  const report: NodeClauseReport = {
    included_clauses: [],
    skipped_clauses: [],
    missing_fields: [],
    warnings: [...(snapshot.warnings ?? [])],
  }
  for (const override of snapshot.overrides.values()) {
    const publication = snapshot.clauses.get(override.clauseKey)
    if (!publication || publication.clauseId !== override.clauseId) {
      throw new Error(`Estate clause override ${override.id} references a missing publication: ${override.clauseKey}`)
    }
    if (!publication.conditionField?.trim()) {
      throw new Error(`Estate clause override ${override.id} cannot target unconditional publication ${override.clauseKey}; only conditional clauses may be overridden.`)
    }
  }

  function getClause(clauseId: string): PublishedEstateClause {
    const clause = snapshot.clauses.get(clauseId)
    if (!clause) {
      const unavailable = snapshot.unavailableClauses?.get(clauseId)
      if (unavailable) {
        throw new Error(`Clause ${clauseId} is marked ${JSON.stringify(unavailable.reviewStatus)}. Use allowDraft to generate draft documents.`)
      }
      throw new Error(`Clause not found: ${clauseId}`)
    }
    return clause
  }

  function include(clauseId: string, context: NodeEstateContext, lookupState = state): string {
    if (lookupState !== state) {
      report.warnings.push(`Requested clause ${clauseId} for state ${lookupState}; active state is ${state}.`)
    }

    const clause = getClause(clauseId)
    if (documentTypes && !clause.documentTypes.some(type => documentTypes.includes(type))) {
      throw new Error(`Published clause ${clauseId} is incompatible with target document type(s): ${documentTypes.join(', ')}`)
    }
    const override = snapshot.overrides.get(clauseId)
    if (override?.action === 'force_omit') {
      report.skipped_clauses.push({
        id: clauseId,
        reason: `attorney override: ${override.reason}`,
        source: clause.sourceFile,
        selection_reason: 'attorney_override',
        override_id: override.id,
        clause_id: clause.clauseId,
        clause_key: clause.clauseKey,
        revision_id: clause.revisionId,
        content_hash: clause.contentHash,
        override_action: 'force_omit',
      })
      return ''
    }

    const condition = clause.conditionField
    if (!override && condition && !isPresent(context[condition])) {
      report.skipped_clauses.push({
        id: clauseId,
        reason: `condition false: ${condition}`,
        source: clause.sourceFile,
      })
      return ''
    }

    const reviewStatus = clause.reviewStatus
    if (reviewStatus !== 'approved' && !allowDraft) {
      throw new Error(`Clause ${clauseId} is marked ${JSON.stringify(reviewStatus)}. Use allowDraft to generate draft documents.`)
    }

    // Record missing required fields but still render the clause — empty values
    // surface as visible `[[ MISSING: field ]]` markers so the draft always
    // renders with its holes loud rather than failing the whole document.
    const missing = missingRequiredFields(context, clause.requiredFields)
    if (missing.length > 0) {
      report.missing_fields.push(...missing)
    }

    report.included_clauses.push({
      id: clauseId,
      clause_id: clause.clauseId,
      clause_key: clause.clauseKey,
      revision_id: clause.revisionId,
      content_hash: clause.contentHash,
      title: clause.title,
      jurisdiction: clause.sourceJurisdiction ?? clause.jurisdiction,
      source: clause.sourceFile,
      review_status: reviewStatus,
      selection_reason: override ? 'attorney_override' : 'template_rule',
      override_id: override?.id ?? null,
    })

    return renderNodeEstateText(clause.text, context, {
      include_clause: (nestedClauseId: string, nestedState?: string) => include(nestedClauseId, context, nestedState),
    })
  }

  return { report, include }
}
