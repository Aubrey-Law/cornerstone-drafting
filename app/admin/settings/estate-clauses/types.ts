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
  submittedRevisions: ClauseRevisionDto[]
  currentPublication: {
    current_revision_id: string
    published_at: string
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

export function validationMessages(report: unknown): string[] {
  if (Array.isArray(report)) return report.map(String)
  if (report && typeof report === 'object') {
    return Object.entries(report).flatMap(([key, value]) => (
      Array.isArray(value) ? value.map(item => `${key}: ${String(item)}`) : [`${key}: ${String(value)}`]
    ))
  }
  return report == null ? [] : [String(report)]
}
