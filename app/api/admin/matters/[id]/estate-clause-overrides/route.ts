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

async function context(req: Request, params: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return { response: auth.err ?? Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params.params
  const canonicalMatterId = await resolveMatterId(id)
  const loaded = await loadEligibleClauses(canonicalMatterId)
  return { ...loaded, canonicalMatterId, actorId: auth.userId }
}

export async function GET(req: Request, params: Params) {
  try {
    const loaded = await context(req, params)
    if ('response' in loaded) return loaded.response
    const { data, error } = await loaded.admin
      .from('matter_estate_clause_overrides')
      .select('id,clause_id,action,reason,created_by')
      .eq('matter_id', loaded.canonicalMatterId)
    if (error) throw new Error(error.message)
    const overrides = new Map((data ?? []).map(row => [row.clause_id, row as OverrideRow]))
    return Response.json({
      matterId: loaded.canonicalMatterId,
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
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load clause overrides' }, { status: 500 })
  }
}

export async function PUT(req: Request, params: Params) {
  let body: OverrideRequest
  try {
    body = parseOverrideRequest(await req.json())
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid override request' }, { status: 400 })
  }
  try {
    const loaded = await context(req, params)
    if ('response' in loaded) return loaded.response
    const clause = loaded.eligible.get(body.clauseKey)
    if (!clause) {
      return Response.json({ error: 'Clause is not a current conditional publication referenced by a selected template.' }, { status: 409 })
    }
    const { data, error } = await loaded.admin
      .from('matter_estate_clause_overrides')
      .upsert({
        matter_id: loaded.canonicalMatterId,
        clause_id: clause.clauseId,
        action: body.action,
        reason: body.reason,
        created_by: loaded.actorId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'matter_id,clause_id' })
      .select('id,clause_id,action,reason,created_by')
      .single()
    if (error) throw new Error(error.message)
    return Response.json({ override: data })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save clause override' }, { status: 500 })
  }
}

export async function DELETE(req: Request, params: Params) {
  let body: { clauseKey: string }
  try {
    body = parseDeleteOverrideRequest(await req.json())
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid override request' }, { status: 400 })
  }
  try {
    const loaded = await context(req, params)
    if ('response' in loaded) return loaded.response
    const clause = loaded.eligible.get(body.clauseKey)
    if (!clause) {
      return Response.json({ error: 'Clause is not a current conditional publication referenced by a selected template.' }, { status: 409 })
    }
    const { error } = await loaded.admin
      .from('matter_estate_clause_overrides')
      .delete()
      .eq('matter_id', loaded.canonicalMatterId)
      .eq('clause_id', clause.clauseId)
    if (error) throw new Error(error.message)
    return Response.json({ deleted: true, clauseKey: body.clauseKey })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete clause override' }, { status: 500 })
  }
}
