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
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): QueryBuilder<T>
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

export class RuntimeReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  constructor(private readonly map: Map<K, V>) {}

  get size() { return this.map.size }
  get(key: K) { return this.map.get(key) }
  has(key: K) { return this.map.has(key) }
  entries() { return this.map.entries() }
  keys() { return this.map.keys() }
  values() { return this.map.values() }
  [Symbol.iterator]() { return this.map[Symbol.iterator]() }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
    for (const [key, value] of this.map) callbackfn.call(thisArg, value, key, this)
  }

  set(): never {
    throw new TypeError('ReadonlyMap cannot be mutated')
  }

  delete(): never {
    throw new TypeError('ReadonlyMap cannot be mutated')
  }

  clear(): never {
    throw new TypeError('ReadonlyMap cannot be mutated')
  }
}

export function runtimeReadonlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  return new RuntimeReadonlyMap(map)
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
    reviewStatus: 'approved',
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
  comment: string
}) {
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
  expectedCurrentRevisionId: string | null
  currentTemplateSnapshotHash: string
}) {
  const result = await args.client.rpc('publish_estate_clause_revision', {
    p_revision_id: args.revisionId,
    p_actor_id: args.actorId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
    p_current_template_snapshot_hash: args.currentTemplateSnapshotHash,
  })
  return requireData(result, 'Estate clause publication returned no result')
}

export async function retireEstateClausePublication(args: {
  client: EstateClauseClient
  clauseId: string
  actorId: string
  expectedCurrentRevisionId: string
  reason: string
}) {
  const result = await args.client.rpc('retire_estate_clause_publication', {
    p_clause_id: args.clauseId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
    p_reason: args.reason,
    p_actor_id: args.actorId,
  })
  return requireData(result, 'Estate clause retirement returned no event')
}

export async function revertEstateClausePublication(args: {
  client: EstateClauseClient
  clauseId: string
  targetRevisionId: string
  actorId: string
  expectedCurrentRevisionId: string | null
  currentTemplateSnapshotHash: string
  reason: string
}) {
  const result = await args.client.rpc('revert_estate_clause_publication', {
    p_clause_id: args.clauseId,
    p_target_revision_id: args.targetRevisionId,
    p_expected_current_revision_id: args.expectedCurrentRevisionId,
    p_current_template_snapshot_hash: args.currentTemplateSnapshotHash,
    p_reason: args.reason,
    p_actor_id: args.actorId,
  })
  return requireData(result, 'Estate clause reversion returned no event')
}

export async function loadPublishedEstateClauseSnapshot(args: {
  client: EstateClauseClient
  matterId: string
}): Promise<EstateClauseSnapshot> {
  const snapshotResult = await args.client.rpc('load_estate_clause_generation_snapshot', {
    p_matter_id: args.matterId,
  })
  const snapshot = requireData(snapshotResult, 'Published estate clause snapshot returned no result') as {
    publications: Array<{
      clause_id: string
      current_revision_id: string
      clause_key: string
      title: string
      jurisdiction: 'MA'
      document_types: EstateDocumentType[]
      revision_number: number
      clause_text: string
      required_fields: string[]
      nested_clause_keys: string[]
      condition_field: string | null
      content_hash: string
    }>
    overrides: Array<{
    id: string
    clause_id: string
    clause_key: string
    publication_revision_id: string
    action: EstateClauseOverride['action']
    reason: string
    created_by: string
    created_at: string
    }>
  }
  const publicationRows: PublishedRow[] = snapshot.publications.map(row => ({
    clause_id: row.clause_id,
    current_revision_id: row.current_revision_id,
    estate_clauses: {
      clause_key: row.clause_key, title: row.title, jurisdiction: row.jurisdiction,
      document_types: row.document_types,
    },
    estate_clause_revisions: {
      revision_number: row.revision_number, clause_text: row.clause_text,
      required_fields: row.required_fields, nested_clause_keys: row.nested_clause_keys,
      condition_field: row.condition_field, content_hash: row.content_hash,
    },
  }))

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
  for (const row of snapshot.overrides) {
    const clauseKey = row.clause_key
    const publication = clauses.get(clauseKey)
    if (!publication || publication.revisionId !== row.publication_revision_id) {
      throw new Error(`Estate clause override ${row.id} was loaded against a mixed publication revision`)
    }
    overrides.set(clauseKey, {
      id: row.id,
      clauseId: row.clause_id,
      clauseKey,
      action: row.action,
      reason: row.reason,
      actorId: row.created_by,
      publicationRevisionId: row.publication_revision_id,
      createdAt: row.created_at,
    })
  }

  return {
    jurisdiction: 'MA',
    clauses: runtimeReadonlyMap(clauses),
    overrides: runtimeReadonlyMap(overrides),
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
  const counts = { created: 0, unchanged: 0, requiresReview: 0, conflicts: 0 }
  const messages: string[] = []

  for (const entry of entries) {
    if (args.dryRun) {
      counts.requiresReview += 1
      if (entry.validationErrors.length === 0) counts.created += 1
      continue
    }
    if (!args.client) throw new Error('Estate clause import requires a service-role client')

    const identityLookup = () => args.client!
      .from('estate_clauses')
      .select('id,clause_key')
      .eq('clause_key', entry.clauseKey)
      .maybeSingle()
    const initialIdentityResult = await identityLookup()
    if (initialIdentityResult.error) throw new Error(initialIdentityResult.error.message)
    let identity = initialIdentityResult.data as {
      id: string
      clause_key: string
    } | null

    if (!identity) {
      const identityInsertResult = await args.client
        .from('estate_clauses')
        .insert({
          clause_key: entry.clauseKey,
          title: entry.title,
          jurisdiction: entry.jurisdiction,
          document_types: entry.documentTypes,
          created_by: args.actorId,
        })
        .select('id,clause_key')
        .single()
      if (!identityInsertResult.error && identityInsertResult.data) {
        identity = identityInsertResult.data as { id: string; clause_key: string }
      } else {
        const raceWinnerResult = await identityLookup()
        if (raceWinnerResult.error) throw new Error(raceWinnerResult.error.message)
        identity = raceWinnerResult.data as { id: string; clause_key: string } | null
        if (!identity) {
          throw new Error(
            identityInsertResult.error?.message
              ?? `Estate clause ${entry.clauseKey} identity returned no row`,
          )
        }
      }
    }

    const existingResult = await args.client
      .from('estate_clause_revisions')
      .select('id,revision_number')
      .eq('clause_id', identity.id)
      .eq('content_hash', entry.contentHash)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingResult.error) throw new Error(existingResult.error.message)

    const publicationResult = await args.client
      .from('estate_clause_publications')
      .select('current_revision_id')
      .eq('clause_id', identity.id)
      .maybeSingle()
    if (publicationResult.error) throw new Error(publicationResult.error.message)
    const publication = publicationResult.data as { current_revision_id: string } | null
    const existingRevision = existingResult.data as { id: string; revision_number: number } | null
    if (existingRevision) {
      counts.unchanged += 1
      if (publication?.current_revision_id !== existingRevision.id) {
        const latestEventResult = await args.client
          .from('estate_clause_review_events')
          .select('event_type')
          .eq('revision_id', existingRevision.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latestEventResult.error) throw new Error(latestEventResult.error.message)
        const latestEvent = latestEventResult.data as { event_type: string } | null
        if (latestEvent?.event_type === 'submitted') counts.requiresReview += 1
      }
      continue
    }

    const validationReport = { errors: entry.validationErrors, source: entry.source, imported: true }
    const draftLookup = () => args.client!
      .from('estate_clause_working_drafts')
      .select('id,content_hash,validation_status')
      .eq('clause_id', identity.id)
      .eq('author_id', args.actorId)
      .maybeSingle()
    const existingDraftResult = await draftLookup()
    if (existingDraftResult.error) throw new Error(existingDraftResult.error.message)
    const existingDraft = existingDraftResult.data as {
      id: string
      content_hash: string
      validation_status: 'valid' | 'invalid'
    } | null

    if (existingDraft && existingDraft.content_hash !== entry.contentHash) {
      counts.conflicts += 1
      counts.requiresReview += 1
      messages.push(`Preserved existing attorney draft for ${entry.clauseKey}; bundled content was not imported.`)
      continue
    }

    if (existingDraft && entry.validationErrors.length > 0) {
      counts.unchanged += 1
      counts.requiresReview += 1
      continue
    }

    let draft = existingDraft
    if (!draft) {
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
        }, { onConflict: 'clause_id,author_id', ignoreDuplicates: true })
        .select('id,content_hash,validation_status')
        .single()
      if (!draftResult.error && draftResult.data) {
        draft = draftResult.data as {
          id: string
          content_hash: string
          validation_status: 'valid' | 'invalid'
        }
      } else {
        const raceDraftResult = await draftLookup()
        if (raceDraftResult.error) throw new Error(raceDraftResult.error.message)
        const raceDraft = raceDraftResult.data as {
          id: string
          content_hash: string
          validation_status: 'valid' | 'invalid'
        } | null
        if (!raceDraft) {
          throw new Error(
            draftResult.error?.message
              ?? `Estate clause ${entry.clauseKey} working draft returned no row`,
          )
        }
        if (raceDraft.content_hash !== entry.contentHash) {
          counts.conflicts += 1
          counts.requiresReview += 1
          messages.push(`Preserved existing attorney draft for ${entry.clauseKey}; bundled content was not imported.`)
          continue
        }
        draft = raceDraft
      }
    }

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

  return { ...counts, messages, entries }
}
