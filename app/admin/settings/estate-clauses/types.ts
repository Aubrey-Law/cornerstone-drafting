import type { EstateDocumentType } from '@/lib/estateClauses/types'

export type ClauseValidationStatus = 'valid' | 'invalid' | 'pending' | string

export interface ClauseRevisionDto {
  id: string
  clauseId: string
  revisionNumber: number
  authorId: string
  basePublishedRevisionId: string | null
  text: string
  requiredFields: string[]
  nestedClauseKeys: string[]
  conditionField: string | null
  changeSummary: string
  contentHash: string
  validationStatus: ClauseValidationStatus
  validationReport: unknown
  submittedAt: string
  latestReviewEvent: { event_type?: string; eventType?: string } | null
}

export interface ClauseWorkingDraftDto {
  id: string
  clauseId: string
  authorId: string
  basePublishedRevisionId: string | null
  text: string
  requiredFields: string[]
  nestedClauseKeys: string[]
  conditionField: string | null
  changeSummary: string
  contentHash: string
  validationStatus: ClauseValidationStatus
  validationReport: unknown
  updatedAt: string
}

export interface EstateClauseAdminDto {
  id: string
  clauseKey: string
  title: string
  jurisdiction: 'MA'
  documentTypes: EstateDocumentType[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  workingDraft: ClauseWorkingDraftDto | null
  latestChangeRequest: {
    revisionId: string
    revisionNumber: number
    comment: string | null
    reviewerId: string
    createdAt: string
  } | null
  submittedRevisions: ClauseRevisionDto[]
  currentPublication: {
    clause_id: string
    current_revision_id: string
    published_by: string
    published_at: string
    updated_at: string
    revision: ClauseRevisionDto
  } | null
  reviewEvents: Array<Record<string, unknown>>
}

export interface EstateClauseListResponse {
  clauses: EstateClauseAdminDto[]
}

export interface RequestState {
  busy: boolean
  error: string | null
  notice: string | null
}

export const documentTypeLabels: Record<EstateDocumentType, string> = {
  will: 'Will',
  trust: 'Trust',
  durable_power_of_attorney: 'Durable power of attorney',
  health_care_directive: 'Health care directive',
  hipaa_authorization: 'HIPAA authorization',
  ancillary: 'Ancillary',
}

/** Import provenance stored beside the findings: a record of where the clause came from, not a problem with it. */
const PROVENANCE_KEYS = new Set(['source', 'imported'])
const FINDING_LABELS: Record<string, string> = { errors: 'Error', warnings: 'Warning' }

function describe(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

/**
 * The findings in a validation report, one line each. Provenance keys are left
 * out (the bundled import stores the whole source clause under `source`, which
 * used to print as "source: [object Object]"), and nested values are spelled
 * out rather than stringified to "[object Object]".
 */
export function validationMessages(report: unknown): string[] {
  if (Array.isArray(report)) return report.map(describe)
  if (report && typeof report === 'object') {
    return Object.entries(report).flatMap(([key, value]) => {
      if (PROVENANCE_KEYS.has(key)) return []
      const label = FINDING_LABELS[key] ?? key
      return Array.isArray(value) ? value.map(item => `${label}: ${describe(item)}`) : [`${label}: ${describe(value)}`]
    })
  }
  return report == null ? [] : [describe(report)]
}
