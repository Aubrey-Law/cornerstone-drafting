import { requireAdmin } from '@/lib/apiAuth'
import { buildDraftPayload } from '@/lib/buildDraftPayload'
import {
  loadPublishedEstateClauseSnapshot,
  runtimeReadonlyMap,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateClauseSnapshot, EstateDocumentType, PublishedEstateClause } from '@/lib/estateClauses/types'
import { generateEstatePlanDocumentsNode } from '@/lib/estateGenerator/node/generate'
import { getAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

function relation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clauseId: string }> },
) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const { clauseId } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const revisionId = body?.revisionId
  const matterId = body?.matterId
  if (!isUuid(clauseId) || !isUuid(revisionId) || !isUuid(matterId)) {
    return Response.json({ error: 'Valid clause, revision, and representative matter identifiers are required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data, error } = await client
      .from('estate_clause_revisions')
      .select('id,clause_id,revision_number,clause_text,required_fields,nested_clause_keys,condition_field,content_hash,validation_status,validation_report,estate_clauses!inner(clause_key,title,jurisdiction,document_types,is_active)')
      .eq('id', revisionId)
      .eq('clause_id', clauseId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return Response.json({ error: 'Estate clause revision not found' }, { status: 404 })
    const candidateRevision = data as {
      id: string
      clause_id: string
      revision_number: number
      clause_text: string
      required_fields: string[]
      nested_clause_keys: string[]
      condition_field: string | null
      content_hash: string
      validation_status: string
      validation_report: unknown
      estate_clauses: {
        clause_key: string
        title: string
        jurisdiction: 'MA'
        document_types: EstateDocumentType[]
        is_active: boolean
      } | Array<{
        clause_key: string
        title: string
        jurisdiction: 'MA'
        document_types: EstateDocumentType[]
        is_active: boolean
      }>
    }
    if (candidateRevision.validation_status !== 'valid') {
      return Response.json({ error: 'Estate clause revision failed validation', validationReport: candidateRevision.validation_report }, { status: 409 })
    }
    const identity = relation(candidateRevision.estate_clauses)
    if (!identity?.is_active) return Response.json({ error: 'Estate clause not found' }, { status: 404 })

    const currentSnapshot = await loadPublishedEstateClauseSnapshot({ client, matterId })
    const clauses = new Map(currentSnapshot.clauses)
    const candidate: PublishedEstateClause = {
      clauseId,
      clauseKey: identity.clause_key,
      title: identity.title,
      jurisdiction: identity.jurisdiction,
      documentTypes: identity.document_types,
      revisionId: candidateRevision.id,
      revisionNumber: candidateRevision.revision_number,
      text: candidateRevision.clause_text,
      requiredFields: candidateRevision.required_fields,
      nestedClauseKeys: candidateRevision.nested_clause_keys,
      conditionField: candidateRevision.condition_field,
      contentHash: candidateRevision.content_hash,
      reviewStatus: 'submitted',
    }
    clauses.set(candidate.clauseKey, candidate)
    const candidateSnapshot: EstateClauseSnapshot = {
      ...currentSnapshot,
      clauses: runtimeReadonlyMap(clauses),
      overrides: currentSnapshot.overrides,
      source: 'database',
    }

    const payload = await buildDraftPayload(matterId)
    const generated = await generateEstatePlanDocumentsNode(payload, { clauseSnapshot: candidateSnapshot })
    if (!generated.ok) {
      return Response.json({ error: generated.error, validationReport: candidateRevision.validation_report }, { status: 409 })
    }
    const candidateAppears = generated.files.some(file => (
      file.clauseManifest.some(entry => entry.revisionId === candidateRevision.id)
    ))
    if (!candidateAppears) {
      return Response.json({ error: 'Candidate revision did not appear in any generated document' }, { status: 409 })
    }

    const validationReport = {
      candidate: candidateRevision.validation_report,
      missingFields: generated.missing,
      warnings: generated.warnings,
      unresolvedMarkers: generated.files.flatMap(file => file.unresolvedMarkers ?? []),
    }
    const files = generated.files.map(file => ({
      filename: file.name,
      base64: file.buffer.toString('base64'),
    }))
    return Response.json({ files, validationReport })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to preview estate clause revision'
    const status = /matter not found|revision not found|clause not found/i.test(message) ? 404 : 500
    return Response.json({ error: message }, { status })
  }
}
