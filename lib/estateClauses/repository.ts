import type {
  EstateClauseContent,
  EstateClauseOverride,
  EstateClauseSnapshot,
  EstateDocumentType,
  PublishedEstateClause,
} from '@/lib/estateClauses/types'
import { hashEstateClauseContent, validateEstateClauseContent } from '@/lib/estateClauses/validation'

type DatabaseError = { message: string }
type DatabaseResult<T> = { data: T; error: DatabaseError | null }

interface QueryBuilder<T = unknown> extends PromiseLike<DatabaseResult<T[]>> {
  select(columns: string): QueryBuilder<T>
  eq(column: string, value: unknown): QueryBuilder<T>
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>
  limit(count: number): QueryBuilder<T>
  upsert(values: unknown, options?: { onConflict?: string }): QueryBuilder<T>
  insert(values: unknown): QueryBuilder<T>
  single(): PromiseLike<DatabaseResult<T>>
  maybeSingle(): PromiseLike<DatabaseResult<T | null>>
}

export interface EstateClauseClient {
  from(table: string): QueryBuilder
  rpc(name: string, params: Record<string, unknown>): PromiseLike<DatabaseResult<unknown>>
}

function requireData<T>(result: DatabaseResult<T>, message: string): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null || result.data === undefined) throw new Error(message)
  return result.data
}

function relation<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value
}

type PublishedRow = {
  clause_id: string
  current_revision_id: string
  estate_clauses: {
    clause_key: string
    title: string
    jurisdiction: 'MA'
    document_types: EstateDocumentType[]
  } | Array<{
    clause_key: string
    title: string
    jurisdiction: 'MA'
    document_types: EstateDocumentType[]
  }>
  estate_clause_revisions: {
    revision_number: number
    clause_text: string
    required_fields: string[]
    nested_clause_keys: string[]
    condition_field: string | null
    content_hash: string
  } | Array<{
    revision_number: number
    clause_text: string
    required_fields: string[]
    nested_clause_keys: string[]
    condition_field: string | null
    content_hash: string
  }>
}

function mapPublishedClause(row: PublishedRow): PublishedEstateClause {
  const clause = relation(row.estate_clauses)
  const revision = relation(row.estate_clause_revisions)
  return {
    clauseId: row.clause_id,
    clauseKey: clause.clause_key,
    title: clause.title,
    jurisdiction: clause.jurisdiction,
    documentTypes: clause.document_types,
    revisionId: row.current_revision_id,
    revisionNumber: revision.revision_number,
    text: revision.clause_text,
    requiredFields: revision.required_fields,
    nestedClauseKeys: revision.nested_clause_keys,
    conditionField: revision.condition_field,
    contentHash: revision.content_hash,
  }
}

export async function listEstateClauses(args: { client: EstateClauseClient }) {
  const result = await args.client
    .from('estate_clauses')
    .select('id,clause_key,title,jurisdiction,document_types,is_active,created_at,updated_at')
    .order('clause_key', { ascending: true })
  const rows = requireData(result, 'Estate clause list returned no rows') as Array<{
    id: string
    clause_key: string
    title: string
    jurisdiction: 'MA'
    document_types: EstateDocumentType[]
    is_active: boolean
    created_at: string
    updated_at: string
  }>
  return rows.map(row => ({
    id: row.id,
    clauseKey: row.clause_key,
    title: row.title,
    jurisdiction: row.jurisdiction,
    documentTypes: row.document_types,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function saveEstateClauseDraft(args: {
  client: EstateClauseClient
  clauseId: string
  authorId: string
  basePublishedRevisionId: string | null
  content: EstateClauseContent
  changeSummary: string
  catalog: ReadonlySet<string>
}) {
  const errors = validateEstateClauseContent(args.content, args.catalog)
  const result = await args.client
    .from('estate_clause_working_drafts')
    .upsert({
      clause_id: args.clauseId,
      author_id: args.authorId,
      base_published_revision_id: args.basePublishedRevisionId,
      clause_text: args.content.text,
      required_fields: args.content.requiredFields,
      nested_clause_keys: args.content.nestedClauseKeys,
      condition_field: args.content.conditionField ?? null,
      change_summary: args.changeSummary,
      content_hash: hashEstateClauseContent(args.content),
      validation_status: errors.length === 0 ? 'valid' : 'invalid',
      validation_report: { errors },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clause_id,author_id' })
    .select('id,clause_id,author_id,base_published_revision_id,content_hash,validation_status,validation_report,updated_at')
    .single()
  return requireData(result, 'Estate clause draft save returned no row')
}

export async function submitEstateClauseDraft(args: {
  client: EstateClauseClient
  workingDraftId: string
  actorId: string
}) {
  const result = await args.client.rpc('submit_estate_clause_revision', {
    p_working_draft_id: args.workingDraftId,
    p_actor_id: args.actorId,
  })
  return requireData(result, 'Estate clause submission returned no revision')
}

export async function requestEstateClauseChanges(args: {
  client: EstateClauseClient
  revisionId: string
  actorId: string
  authorId: string
  comment: string
}) {
  if (args.actorId === args.authorId) {
    throw new Error('A different attorney or administrator must review this revision.')
  }
  const result = await args.client.rpc('request_estate_clause_changes', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_comment: args.comment,
  })
  return requireData(result, 'Estate clause change request returned no event')
}

export async function publishEstateClauseRevision(args: {
  client: EstateClauseClient
  revisionId: string
  actorId: string
  authorId: string
  expectedCurrentRevisionId: string | null
}) {
  if (args.actorId === args.authorId) {
    throw new Error('A different attorney or administrator must publish this revision.')
  }
  const result = await args.client.rpc('publish_estate_clause_revision', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
  })
  return requireData(result, 'Estate clause publication returned no result')
}

export async function loadPublishedEstateClauseSnapshot(args: {
  client: EstateClauseClient
  matterId: string
}): Promise<EstateClauseSnapshot> {
  const publicationsResult = await args.client
    .from('estate_clause_publications')
    .select('clause_id,current_revision_id,estate_clauses!inner(clause_key,title,jurisdiction,document_types,is_active),estate_clause_revisions!inner(revision_number,clause_text,required_fields,nested_clause_keys,condition_field,content_hash)')
    .eq('estate_clauses.is_active', true)
  const publicationRows = requireData(publicationsResult, 'Published estate clause query returned no rows') as PublishedRow[]

  const overridesResult = await args.client
    .from('matter_estate_clause_overrides')
    .select('id,clause_id,action,reason,created_by,estate_clauses!inner(clause_key)')
    .eq('matter_id', args.matterId)
  const overrideRows = requireData(overridesResult, 'Matter estate clause override query returned no rows') as Array<{
    id: string
    clause_id: string
    action: EstateClauseOverride['action']
    reason: string
    created_by: string
    estate_clauses: { clause_key: string } | Array<{ clause_key: string }>
  }>

  const clauses = new Map<string, PublishedEstateClause>()
  for (const row of publicationRows) {
    const mapped = mapPublishedClause(row)
    const actualHash = hashEstateClauseContent(mapped)
    if (actualHash !== mapped.contentHash) {
      throw new Error(`Published clause ${mapped.clauseKey} failed its integrity check`)
    }
    clauses.set(mapped.clauseKey, mapped)
  }

  const overrides = new Map<string, EstateClauseOverride>()
  for (const row of overrideRows) {
    const clauseKey = relation(row.estate_clauses).clause_key
    overrides.set(clauseKey, {
      id: row.id,
      clauseId: row.clause_id,
      clauseKey,
      action: row.action,
      reason: row.reason,
      actorId: row.created_by,
    })
  }

  return {
    jurisdiction: 'MA',
    clauses: Object.freeze(clauses),
    overrides: Object.freeze(overrides),
    source: 'database',
  }
}

export interface BundledEstateClause {
  id: string
  title: string
  document_type: EstateDocumentType
  jurisdiction: string
  condition?: string | null
  required_fields?: string[]
  nested_clause_keys?: string[]
  text: string
  [key: string]: unknown
}

export interface NormalizedBundledEstateClause {
  source: BundledEstateClause
  clauseKey: string
  title: string
  jurisdiction: 'MA'
  documentTypes: EstateDocumentType[]
  content: EstateClauseContent
  contentHash: string
  validationErrors: string[]
}

function normalizeBundledClause(
  source: BundledEstateClause,
  catalog: ReadonlySet<string>,
): NormalizedBundledEstateClause {
  const content: EstateClauseContent = {
    text: source.text,
    requiredFields: source.required_fields ?? [],
    nestedClauseKeys: source.nested_clause_keys ?? [],
    conditionField: source.condition ?? null,
  }
  return {
    source: { ...source },
    clauseKey: source.id,
    title: source.title,
    jurisdiction: 'MA',
    documentTypes: [source.document_type],
    content,
    contentHash: hashEstateClauseContent(content),
    validationErrors: validateEstateClauseContent(content, catalog),
  }
}

export async function importBundledEstateClauses(args: {
  client?: EstateClauseClient
  actorId: string
  dryRun?: boolean
  bundledClauses: BundledEstateClause[]
}) {
  const catalog = new Set(args.bundledClauses.map(clause => clause.id))
  const entries = args.bundledClauses.map(clause => normalizeBundledClause(clause, catalog))
  const counts = { created: 0, unchanged: 0, requiresReview: 0 }

  for (const entry of entries) {
    if (args.dryRun) {
      counts.requiresReview += 1
      if (entry.validationErrors.length === 0) counts.created += 1
      continue
    }
    if (!args.client) throw new Error('Estate clause import requires a service-role client')

    const identityResult = await args.client
      .from('estate_clauses')
      .upsert({
        clause_key: entry.clauseKey,
        title: entry.title,
        jurisdiction: entry.jurisdiction,
        document_types: entry.documentTypes,
        created_by: args.actorId,
      }, { onConflict: 'clause_key' })
      .select('id,clause_key')
      .single()
    const identity = requireData(identityResult, `Estate clause ${entry.clauseKey} identity returned no row`) as {
      id: string
      clause_key: string
    }

    const existingResult = await args.client
      .from('estate_clause_revisions')
      .select('id,revision_number')
      .eq('clause_id', identity.id)
      .eq('content_hash', entry.contentHash)
      .maybeSingle()
    if (existingResult.error) throw new Error(existingResult.error.message)
    if (existingResult.data) {
      counts.unchanged += 1
      continue
    }

    const publicationResult = await args.client
      .from('estate_clause_publications')
      .select('current_revision_id')
      .eq('clause_id', identity.id)
      .maybeSingle()
    if (publicationResult.error) throw new Error(publicationResult.error.message)
    const publication = publicationResult.data as { current_revision_id: string } | null
    const validationReport = { errors: entry.validationErrors, source: entry.source, imported: true }
    const draftResult = await args.client
      .from('estate_clause_working_drafts')
      .upsert({
        clause_id: identity.id,
        author_id: args.actorId,
        base_published_revision_id: publication?.current_revision_id ?? null,
        clause_text: entry.content.text,
        required_fields: entry.content.requiredFields,
        nested_clause_keys: entry.content.nestedClauseKeys,
        condition_field: entry.content.conditionField ?? null,
        content_hash: entry.contentHash,
        change_summary: 'Import bundled estate clause for independent review.',
        validation_status: entry.validationErrors.length === 0 ? 'valid' : 'invalid',
        validation_report: validationReport,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clause_id,author_id' })
      .select('id,validation_status,validation_report')
      .single()
    const draft = requireData(draftResult, `Estate clause ${entry.clauseKey} working draft returned no row`) as { id: string }

    counts.requiresReview += 1
    if (entry.validationErrors.length > 0) continue

    const submissionResult = await args.client.rpc('submit_estate_clause_revision', {
      p_working_draft_id: draft.id,
      p_actor_id: args.actorId,
    })
    requireData(
      submissionResult,
      `Estate clause ${entry.clauseKey} submission returned no revision`,
    )
    counts.created += 1
  }

  return { ...counts, entries }
}
