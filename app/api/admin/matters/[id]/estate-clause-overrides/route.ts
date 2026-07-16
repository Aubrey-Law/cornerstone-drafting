import { requireAdmin } from '@/lib/apiAuth'
import { buildDraftPayload, resolveMatterId, type DraftPayload } from '@/lib/buildDraftPayload'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  selectedEstateTemplateReferences,
  type SelectedEstateTemplateReference,
} from '@/lib/estateClauses/templateReferences'
import type { EstateClauseOverrideAction, EstateDocumentType } from '@/lib/estateClauses/types'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { dataForNodeEstatePackage } from '@/lib/estateGenerator/node/packageData'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'
import { isPresent } from '@/lib/estateGenerator/node/validation'
import { toEstateGeneratorData } from '@/lib/estateGenerator/toGeneratorData'

type Params = { params: Promise<{ id: string }> }

const STABLE_KEY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/
const PUT_KEYS = ['action', 'clauseKey', 'reason']
const DELETE_KEYS = ['clauseKey']

export interface OverrideRequest {
  clauseKey: string
  action: EstateClauseOverrideAction
  reason: string
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

export function parseDeleteOverrideRequest(value: unknown): { clauseKey: string } {
  const body = record(value)
  if (!exactKeys(body, DELETE_KEYS)) throw new Error('Delete body must contain exactly clauseKey.')
  const clauseKey = typeof body.clauseKey === 'string' ? body.clauseKey.trim() : ''
  if (!STABLE_KEY_RE.test(clauseKey)) throw new Error('A valid stable clause key is required.')
  return { clauseKey }
}

export function overrideMutationErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unable to save clause override'
  const conflict = /current estate clause revision changed|not a current active conditional publication/i.test(message)
  return Response.json({ error: message }, { status: conflict ? 409 : 500 })
}

type PublishedRow = {
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

type OverrideRow = {
  id: string
  clause_id: string
  action: EstateClauseOverrideAction
  reason: string
  created_by: string
  estate_clauses?: { clause_key: string; title: string } | Array<{ clause_key: string; title: string }>
}

export function isPublishedClauseOverrideEligible(
  row: PublishedRow,
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

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

function defaultOutcome(
  conditionField: string,
  references: SelectedEstateTemplateReference[],
  clauseKey: string,
  documentTypes: EstateDocumentType[],
  payload: DraftPayload,
): 'include' | 'omit' | 'mixed' {
  const data = toEstateGeneratorData(payload)
  const outcomes = new Set<boolean>()
  for (const reference of references) {
    if (!reference.clauseKeys.includes(clauseKey)) continue
    if (!reference.documentTypes.some(type => documentTypes.includes(type))) continue
    const packageData = dataForNodeEstatePackage(data as unknown as NodeEstateData, reference.packageName)
    const context = buildNodeEstateContext({ data: packageData, state: 'MA' })
    outcomes.add(isPresent(context[conditionField]))
  }
  if (outcomes.size > 1) return 'mixed'
  return outcomes.has(true) ? 'include' : 'omit'
}

async function loadEligibleClauses(canonicalMatterId: string) {
  const admin = getAdminClient()
  const payload = await buildDraftPayload(canonicalMatterId)
  const references = await selectedEstateTemplateReferences(payload)
  const referencedTypes = new Map<string, Set<EstateDocumentType>>()
  for (const reference of references) {
    for (const clauseKey of reference.clauseKeys) {
      const types = referencedTypes.get(clauseKey) ?? new Set<EstateDocumentType>()
      for (const documentType of reference.documentTypes) types.add(documentType)
      referencedTypes.set(clauseKey, types)
    }
  }

  const { data, error } = await admin
    .from('estate_clause_publications')
    .select('clause_id,current_revision_id,estate_clauses!inner(clause_key,title,document_types,is_active),estate_clause_revisions!inner(revision_number,condition_field)')
    .eq('estate_clauses.is_active', true)
  if (error) throw new Error(error.message)

  const eligible = new Map<string, {
    clauseId: string
    clauseKey: string
    title: string
    documentTypes: EstateDocumentType[]
    conditionField: string
    currentRevisionId: string
    revisionNumber: number
    defaultOutcome: 'include' | 'omit' | 'mixed'
  }>()
  for (const row of (data ?? []) as unknown as PublishedRow[]) {
    const clause = one(row.estate_clauses)
    const revision = one(row.estate_clause_revisions)
    if (!isPublishedClauseOverrideEligible(row, referencedTypes)) continue
    const conditionField = revision.condition_field
    if (!conditionField) continue
    eligible.set(clause.clause_key, {
      clauseId: row.clause_id,
      clauseKey: clause.clause_key,
      title: clause.title,
      documentTypes: clause.document_types,
      conditionField,
      currentRevisionId: row.current_revision_id,
      revisionNumber: revision.revision_number,
      defaultOutcome: defaultOutcome(conditionField, references, clause.clause_key, clause.document_types, payload),
    })
  }
  return { admin, eligible }
}

async function authorizedMatter(req: Request, params: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return { response: auth.err ?? Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params.params
  const canonicalMatterId = await resolveMatterId(id)
  return { canonicalMatterId, actorId: auth.userId }
}

export async function GET(req: Request, params: Params) {
  try {
    const authorized = await authorizedMatter(req, params)
    if ('response' in authorized) return authorized.response
    const loaded = await loadEligibleClauses(authorized.canonicalMatterId)
    const { data, error } = await loaded.admin
      .from('matter_estate_clause_overrides')
      .select('id,clause_id,action,reason,created_by,estate_clauses!inner(clause_key,title)')
      .eq('matter_id', authorized.canonicalMatterId)
    if (error) throw new Error(error.message)
    const overrideRows = (data ?? []) as unknown as OverrideRow[]
    const overrides = new Map(overrideRows.map(row => [row.clause_id, row]))
    const eligibleClauseIds = new Set([...loaded.eligible.values()].map(clause => clause.clauseId))
    return Response.json({
      matterId: authorized.canonicalMatterId,
      clauses: [...loaded.eligible.values()]
        .sort((a, b) => a.clauseKey.localeCompare(b.clauseKey))
        .map(clause => {
          const override = overrides.get(clause.clauseId)
          return {
            ...clause,
            override: override ? {
              id: override.id,
              action: override.action,
              reason: override.reason,
              actorId: override.created_by,
            } : null,
          }
        }),
      staleOverrides: overrideRows
        .filter(override => !eligibleClauseIds.has(override.clause_id))
        .map(override => {
          const clause = one(override.estate_clauses!)
          return {
            id: override.id,
            clauseId: override.clause_id,
            clauseKey: clause.clause_key,
            title: clause.title,
            action: override.action,
            reason: override.reason,
            actorId: override.created_by,
          }
        })
        .sort((a, b) => a.clauseKey.localeCompare(b.clauseKey)),
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load clause overrides' }, { status: 500 })
  }
}

export async function PUT(req: Request, params: Params) {
  let authorized
  try {
    authorized = await authorizedMatter(req, params)
    if ('response' in authorized) return authorized.response
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to resolve matter' }, { status: 500 })
  }
  let body: OverrideRequest
  try {
    body = parseOverrideRequest(await req.json())
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid override request' }, { status: 400 })
  }
  try {
    const loaded = await loadEligibleClauses(authorized.canonicalMatterId)
    const clause = loaded.eligible.get(body.clauseKey)
    if (!clause) {
      return Response.json({ error: 'Clause is not a current conditional publication referenced by a selected template.' }, { status: 409 })
    }
    const rpcClient = loaded.admin as unknown as {
      rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
    }
    const { data, error } = await rpcClient.rpc('upsert_matter_estate_clause_override', {
      p_matter_id: authorized.canonicalMatterId,
      p_clause_id: clause.clauseId,
      p_expected_current_revision_id: clause.currentRevisionId,
      p_action: body.action,
      p_reason: body.reason,
      p_actor_id: authorized.actorId,
    })
    if (error) throw new Error(error.message)
    return Response.json({ override: data })
  } catch (error) {
    return overrideMutationErrorResponse(error)
  }
}

export async function DELETE(req: Request, params: Params) {
  let authorized
  try {
    authorized = await authorizedMatter(req, params)
    if ('response' in authorized) return authorized.response
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to resolve matter' }, { status: 500 })
  }
  let body: { clauseKey: string }
  try {
    body = parseDeleteOverrideRequest(await req.json())
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid override request' }, { status: 400 })
  }
  try {
    const admin = getAdminClient()
    const { data: override, error: lookupError } = await admin
      .from('matter_estate_clause_overrides')
      .select('id,estate_clauses!inner(clause_key)')
      .eq('matter_id', authorized.canonicalMatterId)
      .eq('estate_clauses.clause_key', body.clauseKey)
      .maybeSingle()
    if (lookupError) throw new Error(lookupError.message)
    if (!override) return Response.json({ error: 'Clause override not found.' }, { status: 404 })
    const { error } = await admin
      .from('matter_estate_clause_overrides')
      .delete()
      .eq('matter_id', authorized.canonicalMatterId)
      .eq('id', override.id)
    if (error) throw new Error(error.message)
    return Response.json({ deleted: true, clauseKey: body.clauseKey })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete clause override' }, { status: 500 })
  }
}
