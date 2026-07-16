import type { EstateClauseOverrideAction, EstateDocumentType } from '@/lib/estateClauses/types'

const STABLE_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/
const PUT_KEYS = ['action', 'clauseKey', 'reason']
const DELETE_KEYS = ['clauseKey', 'reason']

export interface OverrideRequest {
  clauseKey: string
  action: EstateClauseOverrideAction
  reason: string
}

export type PublishedEstateClauseOverrideRow = {
  clause_id: string
  current_revision_id: string
  estate_clauses: {
    clause_key: string
    title: string
    document_types: EstateDocumentType[]
  } | Array<{
    clause_key: string
    title: string
    document_types: EstateDocumentType[]
  }>
  estate_clause_revisions: {
    revision_number: number
    condition_field: string | null
  } | Array<{
    revision_number: number
    condition_field: string | null
  }>
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.')
  }
  return value as Record<string, unknown>
}

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

export function parseOverrideRequest(value: unknown): OverrideRequest {
  const body = record(value)
  if (!exactKeys(body, PUT_KEYS)) {
    throw new Error('Override body must contain exactly clauseKey, action, and reason.')
  }
  const clauseKey = typeof body.clauseKey === 'string' ? body.clauseKey.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!STABLE_KEY_RE.test(clauseKey)) throw new Error('A valid stable clause key is required.')
  if (body.action !== 'force_include' && body.action !== 'force_omit') {
    throw new Error('Override action must be force_include or force_omit.')
  }
  if (reason.length < 10) throw new Error('Override reason must be at least 10 characters.')
  return { clauseKey, action: body.action, reason }
}

export function parseDeleteOverrideRequest(value: unknown): { clauseKey: string; reason: string } {
  const body = record(value)
  if (!exactKeys(body, DELETE_KEYS)) throw new Error('Delete body must contain exactly clauseKey and reason.')
  const clauseKey = typeof body.clauseKey === 'string' ? body.clauseKey.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!STABLE_KEY_RE.test(clauseKey)) throw new Error('A valid stable clause key is required.')
  if (reason.length < 10) throw new Error('Retirement reason must be at least 10 characters.')
  return { clauseKey, reason }
}

export function overrideMutationErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unable to save clause override'
  const conflict = /current estate clause revision changed|not a current active conditional publication/i.test(message)
  return Response.json({ error: message }, { status: conflict ? 409 : 500 })
}

export function isPublishedClauseOverrideEligible(
  row: PublishedEstateClauseOverrideRow,
  referencedTypes: ReadonlyMap<string, ReadonlySet<EstateDocumentType>>,
): boolean {
  const clause = one(row.estate_clauses)
  const revision = one(row.estate_clause_revisions)
  const referenced = referencedTypes.get(clause.clause_key)
  return Boolean(
    revision.condition_field?.trim()
    && referenced
    && clause.document_types.some(type => referenced.has(type)),
  )
}
