import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  importBundledEstateClauses,
  loadPublishedEstateClauseSnapshot,
  publishEstateClauseRevision,
  requestEstateClauseChanges,
  saveEstateClauseDraft,
  submitEstateClauseDraft,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import { hashEstateClauseContent } from '@/lib/estateClauses/validation'

type QueryResult = { data: unknown; error: { message: string } | null }

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly result: QueryResult,
    private readonly calls: Array<{ method: string; args: unknown[] }>,
  ) {}

  private chain(method: string, ...args: unknown[]): this {
    this.calls.push({ method, args })
    return this
  }

  select(...args: unknown[]) { return this.chain('select', ...args) }
  eq(...args: unknown[]) { return this.chain('eq', ...args) }
  order(...args: unknown[]) { return this.chain('order', ...args) }
  limit(...args: unknown[]) { return this.chain('limit', ...args) }
  upsert(...args: unknown[]) { return this.chain('upsert', ...args) }
  insert(...args: unknown[]) { return this.chain('insert', ...args) }
  single(...args: unknown[]) { this.chain('single', ...args); return Promise.resolve(this.result) }
  maybeSingle(...args: unknown[]) { this.chain('maybeSingle', ...args); return Promise.resolve(this.result) }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

function fakeClient(results: Record<string, QueryResult | QueryResult[]> = {}) {
  const tableCalls: Array<{ table: string; calls: Array<{ method: string; args: unknown[] }> }> = []
  const rpc = vi.fn().mockResolvedValue({ data: 'rpc-result', error: null })
  return {
    tableCalls,
    rpc,
    from: vi.fn((table: string) => {
      const calls: Array<{ method: string; args: unknown[] }> = []
      tableCalls.push({ table, calls })
      const configured = results[table]
      const result = Array.isArray(configured)
        ? configured.shift() ?? { data: null, error: null }
        : configured ?? { data: null, error: null }
      return new FakeQuery(result, calls)
    }),
  }
}

function asRepositoryClient(client: ReturnType<typeof fakeClient>): EstateClauseClient {
  return client as unknown as EstateClauseClient
}

describe('estate clause repository workflow', () => {
  it('saves a working draft without touching publications', async () => {
    const client = fakeClient({ estate_clause_working_drafts: { data: { id: 'draft-1' }, error: null } })

    await saveEstateClauseDraft({
      client: asRepositoryClient(client),
      clauseId: 'clause-1',
      authorId: 'author-1',
      basePublishedRevisionId: 'revision-1',
      content: { text: 'I appoint {{ agent.full_name | name }}.', requiredFields: ['agent.full_name'], nestedClauseKeys: [] },
      changeSummary: 'Clarify the appointment.',
      catalog: new Set(['poa.agent_appointment']),
    })

    expect(client.from).toHaveBeenCalledWith('estate_clause_working_drafts')
    expect(client.from).not.toHaveBeenCalledWith('estate_clause_publications')
  })

  it('submits a draft through the transactional RPC', async () => {
    const client = fakeClient()

    await submitEstateClauseDraft({ client: asRepositoryClient(client), workingDraftId: 'draft-1', actorId: 'author-1' })

    expect(client.rpc).toHaveBeenCalledWith('submit_estate_clause_revision', {
      p_working_draft_id: 'draft-1',
      p_actor_id: 'author-1',
    })
  })

  it('rejects author self-review before calling the RPC', async () => {
    const client = fakeClient()

    await expect(requestEstateClauseChanges({
      client: asRepositoryClient(client),
      revisionId: 'revision-2',
      actorId: 'author-1',
      authorId: 'author-1',
      comment: 'Please revise this language.',
    })).rejects.toThrow('A different attorney or administrator must review this revision.')
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('rejects author publication and otherwise sends the expected current revision', async () => {
    const selfReviewClient = fakeClient()
    await expect(publishEstateClauseRevision({
      revisionId: 'revision-2',
      actorId: 'author-1',
      authorId: 'author-1',
      expectedCurrentRevisionId: 'revision-1',
      client: asRepositoryClient(selfReviewClient),
    })).rejects.toThrow('A different attorney or administrator must publish this revision.')
    expect(selfReviewClient.rpc).not.toHaveBeenCalled()

    const client = fakeClient()
    await publishEstateClauseRevision({
      revisionId: 'revision-2',
      actorId: 'reviewer-1',
      authorId: 'author-1',
      expectedCurrentRevisionId: 'revision-1',
      client: asRepositoryClient(client),
    })
    expect(client.rpc).toHaveBeenCalledWith('publish_estate_clause_revision', {
      p_revision_id: 'revision-2',
      p_actor_id: 'reviewer-1',
      p_expected_current_revision_id: 'revision-1',
    })
  })

  it('rejects a published revision whose canonical content hash does not match', async () => {
    const client = fakeClient({
      estate_clause_publications: {
        data: [{
          clause_id: 'clause-1',
          current_revision_id: 'revision-1',
          estate_clauses: { clause_key: 'will.residuary', title: 'Residuary', jurisdiction: 'MA', document_types: ['will'] },
          estate_clause_revisions: {
            revision_number: 1,
            clause_text: 'All the rest to my descendants.',
            required_fields: [],
            nested_clause_keys: [],
            condition_field: null,
            content_hash: '0'.repeat(64),
          },
        }],
        error: null,
      },
      matter_estate_clause_overrides: { data: [], error: null },
    })

    await expect(loadPublishedEstateClauseSnapshot({ client: asRepositoryClient(client), matterId: 'matter-1' }))
      .rejects.toThrow('Published clause will.residuary failed its integrity check')
  })

  it('returns runtime-immutable clause and override maps', async () => {
    const content = {
      text: 'All the rest to my descendants.',
      requiredFields: [],
      nestedClauseKeys: [],
      conditionField: null,
    }
    const client = fakeClient({
      estate_clause_publications: {
        data: [{
          clause_id: 'clause-1',
          current_revision_id: 'revision-1',
          estate_clauses: { clause_key: 'will.residuary', title: 'Residuary', jurisdiction: 'MA', document_types: ['will'] },
          estate_clause_revisions: {
            revision_number: 1,
            clause_text: content.text,
            required_fields: content.requiredFields,
            nested_clause_keys: content.nestedClauseKeys,
            condition_field: content.conditionField,
            content_hash: hashEstateClauseContent(content),
          },
        }],
        error: null,
      },
      matter_estate_clause_overrides: {
        data: [{
          id: 'override-1',
          clause_id: 'clause-1',
          action: 'force_include',
          reason: 'Attorney approved this matter-specific inclusion.',
          created_by: 'attorney-1',
          estate_clauses: { clause_key: 'will.residuary' },
        }],
        error: null,
      },
    })

    const snapshot = await loadPublishedEstateClauseSnapshot({
      client: asRepositoryClient(client),
      matterId: 'matter-1',
    })

    expect(snapshot.clauses.size).toBe(1)
    expect([...snapshot.clauses.keys()]).toEqual(['will.residuary'])
    expect(snapshot.overrides.get('will.residuary')?.id).toBe('override-1')
    expect(() => (snapshot.clauses as Map<string, unknown>).set('other', {})).toThrow('ReadonlyMap cannot be mutated')
    expect(() => (snapshot.overrides as Map<string, unknown>).delete('will.residuary')).toThrow('ReadonlyMap cannot be mutated')
    expect(() => (snapshot.overrides as Map<string, unknown>).clear()).toThrow('ReadonlyMap cannot be mutated')
  })

  it('preserves bundled JSON metadata and maps condition to conditionField during import', async () => {
    const source = {
      id: 'execution.affidavit',
      title: 'Affidavit',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: 'requires_affidavit',
      required_fields: ['client.full_name'],
      review_status: 'approved',
      version_date: '2026-07-15',
      text: 'Signed by {{ client.full_name | name }}.',
      extra_metadata: { provenance: 'bundled' },
    }

    const client = fakeClient()
    const result = await importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'author-1',
      dryRun: true,
      bundledClauses: [source],
    })

    expect(result.entries[0].source).toEqual(source)
    expect(result.entries[0].content.conditionField).toBe(source.condition)
    expect(result).toMatchObject({ created: 1, unchanged: 0, requiresReview: 1 })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('submits valid bundled content through the atomic workflow RPC without publishing', async () => {
    const client = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
      estate_clause_revisions: { data: null, error: null },
      estate_clause_working_drafts: [
        { data: null, error: null },
        { data: { id: 'draft-1' }, error: null },
      ],
    })
    const source = {
      id: 'execution.affidavit',
      title: 'Affidavit',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: null,
      required_fields: ['client.full_name'],
      text: 'Signed by {{ client.full_name | name }}.',
    }

    const result = await importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'author-1',
      bundledClauses: [source],
    })

    expect(client.rpc).toHaveBeenCalledWith('submit_estate_clause_revision', {
      p_working_draft_id: 'draft-1',
      p_actor_id: 'author-1',
    })
    expect(client.rpc).not.toHaveBeenCalledWith('publish_estate_clause_revision', expect.anything())
    expect(result).toMatchObject({ created: 1, unchanged: 0, requiresReview: 1 })
  })

  it('retains invalid bundled content as a working draft and never fabricates a revision', async () => {
    const client = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: 'will.conditional' }, error: null },
      estate_clause_revisions: { data: null, error: null },
      estate_clause_working_drafts: [
        { data: null, error: null },
        { data: { id: 'draft-1' }, error: null },
      ],
    })
    const source = {
      id: 'will.conditional',
      title: 'Conditional legacy clause',
      document_type: 'will' as const,
      jurisdiction: 'base',
      condition: null,
      required_fields: [],
      text: '{% if has_children %}To my descendants.{% endif %}',
    }

    const result = await importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'author-1',
      bundledClauses: [source],
    })

    const draftCall = client.tableCalls.find(call => (
      call.table === 'estate_clause_working_drafts'
      && call.calls.some(queryCall => queryCall.method === 'upsert')
    ))
    expect(draftCall?.calls).toContainEqual(expect.objectContaining({
      method: 'upsert',
      args: [expect.objectContaining({ validation_status: 'invalid' }), {
        onConflict: 'clause_id,author_id',
        ignoreDuplicates: true,
      }],
    }))
    expect(client.from).not.toHaveBeenCalledWith('estate_clause_review_events')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(result).toMatchObject({ created: 0, unchanged: 0, requiresReview: 1 })
  })

  it('recovers idempotently when a valid draft submission is retried after an interrupted call', async () => {
    const client = fakeClient({
      estate_clauses: [
        { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
        { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
      ],
      estate_clause_revisions: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      estate_clause_working_drafts: [
        { data: null, error: null },
        { data: { id: 'draft-1' }, error: null },
        { data: null, error: null },
        { data: { id: 'draft-1' }, error: null },
      ],
    })
    client.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'connection interrupted' } })
      .mockResolvedValueOnce({ data: 'revision-1', error: null })
    const source = {
      id: 'execution.affidavit',
      title: 'Affidavit',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: null,
      required_fields: [],
      text: 'Signed and sworn.',
    }
    const args = {
      client: asRepositoryClient(client),
      actorId: 'author-1',
      bundledClauses: [source],
    }

    await expect(importBundledEstateClauses(args)).rejects.toThrow('connection interrupted')
    await expect(importBundledEstateClauses(args)).resolves.toMatchObject({ created: 1 })

    expect(client.rpc).toHaveBeenCalledTimes(2)
    const upsertCalls = client.tableCalls.filter(call => (
      call.table === 'estate_clause_working_drafts'
      && call.calls.some(queryCall => queryCall.method === 'upsert')
    ))
    expect(upsertCalls).toHaveLength(2)
    for (const call of upsertCalls) {
      expect(call.calls).toContainEqual(expect.objectContaining({
        method: 'upsert',
        args: [expect.anything(), { onConflict: 'clause_id,author_id', ignoreDuplicates: true }],
      }))
    }
  })

  it('preserves a different attorney working draft and reports an import conflict', async () => {
    const client = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
      estate_clause_revisions: { data: null, error: null },
      estate_clause_publications: { data: null, error: null },
      estate_clause_working_drafts: { data: { id: 'draft-1', content_hash: 'attorney-edited-hash' }, error: null },
    })
    const source = {
      id: 'execution.affidavit',
      title: 'Bundled title',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: null,
      required_fields: [],
      text: 'Bundled clause text.',
    }

    const result = await importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'author-1',
      bundledClauses: [source],
    })

    const draftCalls = client.tableCalls.filter(call => call.table === 'estate_clause_working_drafts')
    expect(draftCalls).toHaveLength(1)
    expect(draftCalls[0].calls.some(call => call.method === 'upsert' || call.method === 'insert')).toBe(false)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(result).toMatchObject({ created: 0, unchanged: 0, requiresReview: 1, conflicts: 1 })
    expect(result.messages[0]).toContain('execution.affidavit')
  })

  it('preserves existing stable identity metadata and creation provenance', async () => {
    const client = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
      estate_clause_revisions: { data: { id: 'revision-1', revision_number: 1 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-1' }, error: null },
    })
    const source = {
      id: 'execution.affidavit',
      title: 'A changed bundled title that must not overwrite metadata',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: null,
      required_fields: [],
      text: 'Signed and sworn.',
    }

    await importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'different-author',
      bundledClauses: [source],
    })

    const identityCalls = client.tableCalls.filter(call => call.table === 'estate_clauses')
    expect(identityCalls).toHaveLength(1)
    expect(identityCalls[0].calls.some(call => call.method === 'upsert' || call.method === 'insert')).toBe(false)
  })

  it('reselects the stable identity after a concurrent insert wins the race', async () => {
    const client = fakeClient({
      estate_clauses: [
        { data: null, error: null },
        { data: null, error: { message: 'duplicate key value violates unique constraint' } },
        { data: { id: 'clause-race-winner', clause_key: 'execution.affidavit' }, error: null },
      ],
      estate_clause_revisions: { data: { id: 'revision-1', revision_number: 1 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-1' }, error: null },
    })
    const source = {
      id: 'execution.affidavit',
      title: 'Affidavit',
      document_type: 'ancillary' as const,
      jurisdiction: 'MA',
      condition: null,
      required_fields: [],
      text: 'Signed and sworn.',
    }

    await expect(importBundledEstateClauses({
      client: asRepositoryClient(client),
      actorId: 'author-1',
      bundledClauses: [source],
    })).resolves.toMatchObject({ unchanged: 1 })

    expect(client.from).toHaveBeenCalledWith('estate_clauses')
    expect(client.tableCalls.filter(call => call.table === 'estate_clauses')).toHaveLength(3)
  })

  it('selects the latest duplicate same-hash revision deterministically', async () => {
    const client = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: 'execution.affidavit' }, error: null },
      estate_clause_revisions: { data: { id: 'revision-3', revision_number: 3 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-3' }, error: null },
    })
    const source = {
      id: 'execution.affidavit', title: 'Affidavit', document_type: 'ancillary' as const,
      jurisdiction: 'MA', condition: null, required_fields: [], text: 'Signed and sworn.',
    }

    await importBundledEstateClauses({ client: asRepositoryClient(client), actorId: 'author-1', bundledClauses: [source] })

    const revisionCall = client.tableCalls.find(call => call.table === 'estate_clause_revisions')
    expect(revisionCall?.calls).toContainEqual({ method: 'order', args: ['revision_number', { ascending: false }] })
    expect(revisionCall?.calls).toContainEqual({ method: 'limit', args: [1] })
  })

  it('counts submitted-unpublished reruns as requiring review but excludes current publications', async () => {
    const source = {
      id: 'execution.affidavit', title: 'Affidavit', document_type: 'ancillary' as const,
      jurisdiction: 'MA', condition: null, required_fields: [], text: 'Signed and sworn.',
    }
    const publishedClient = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: source.id }, error: null },
      estate_clause_revisions: { data: { id: 'revision-1', revision_number: 1 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-1' }, error: null },
      estate_clause_review_events: { data: { event_type: 'published' }, error: null },
    })
    const unpublishedClient = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: source.id }, error: null },
      estate_clause_revisions: { data: { id: 'revision-2', revision_number: 2 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-1' }, error: null },
      estate_clause_review_events: { data: { event_type: 'submitted' }, error: null },
    })
    const historicalClient = fakeClient({
      estate_clauses: { data: { id: 'clause-1', clause_key: source.id }, error: null },
      estate_clause_revisions: { data: { id: 'revision-1', revision_number: 1 }, error: null },
      estate_clause_publications: { data: { current_revision_id: 'revision-3' }, error: null },
      estate_clause_review_events: { data: { event_type: 'published' }, error: null },
    })

    await expect(importBundledEstateClauses({
      client: asRepositoryClient(publishedClient), actorId: 'author-1', bundledClauses: [source],
    })).resolves.toMatchObject({ unchanged: 1, requiresReview: 0 })
    await expect(importBundledEstateClauses({
      client: asRepositoryClient(unpublishedClient), actorId: 'author-1', bundledClauses: [source],
    })).resolves.toMatchObject({ unchanged: 1, requiresReview: 1 })
    await expect(importBundledEstateClauses({
      client: asRepositoryClient(historicalClient), actorId: 'author-1', bundledClauses: [source],
    })).resolves.toMatchObject({ unchanged: 1, requiresReview: 0 })
  })
})

const routeRoot = path.join(process.cwd(), 'app/api/admin/settings/estate-clauses')

function routeSource(relativePath: string) {
  return fs.readFileSync(path.join(routeRoot, relativePath), 'utf8')
}

describe('estate clause admin route contracts', () => {
  it('authenticates every handler and validates route UUIDs and request bodies', () => {
    const routeFiles = [
      'route.ts',
      '[clauseId]/draft/route.ts',
      '[clauseId]/submit/route.ts',
      '[clauseId]/review/route.ts',
      '[clauseId]/preview/route.ts',
      'draft-ai/route.ts',
    ]

    for (const relativePath of routeFiles) {
      const source = routeSource(relativePath)
      expect(source, relativePath).toContain("import { requireAdmin } from '@/lib/apiAuth'")
      expect(source, relativePath).toContain('await requireAdmin(req)')
      expect(source, relativePath).toContain('status: 400')
    }

    for (const relativePath of routeFiles.filter(file => file.startsWith('[clauseId]'))) {
      expect(routeSource(relativePath), relativePath).toContain('isUuid(clauseId)')
    }
  })

  it('delegates draft, submission, and review transitions to the repository', () => {
    expect(routeSource('[clauseId]/draft/route.ts')).toContain('saveEstateClauseDraft({')
    expect(routeSource('[clauseId]/submit/route.ts')).toContain('submitEstateClauseDraft({')

    const review = routeSource('[clauseId]/review/route.ts')
    expect(review).toContain('requestEstateClauseChanges({')
    expect(review).toContain('publishEstateClauseRevision({')
    expect(review).toContain(".from('estate_clause_revisions')")
    expect(review).toContain(".from('estate_clause_review_events')")
    expect(review).toContain(".from('estate_clause_publications')")
    expect(review).toContain('pendingRevisions.length > 1')
    expect(review).not.toContain('body.authorId')
    expect(review).not.toContain('body.currentRevisionId')
    expect(review).not.toContain('body.revisionId')
    expect(review).toContain('status: 403')
    expect(review).toContain('status: 404')
    expect(review).toContain('status: 409')
  })

  it('previews an injected candidate snapshot without persisting generated artifacts', () => {
    const preview = routeSource('[clauseId]/preview/route.ts')
    expect(preview).toContain('buildDraftPayload(')
    expect(preview).toContain('loadPublishedEstateClauseSnapshot({')
    expect(preview).toContain('clauseSnapshot: candidateSnapshot')
    expect(preview).toContain('file.clauseManifest.some')
    expect(preview).toContain('candidateRevision.id')
    expect(preview).toContain('base64: file.buffer.toString(\'base64\')')
    expect(preview).toContain('validationReport')
    expect(preview).toContain('hashEstateClauseContent(')
    expect(preview).toContain('Candidate revision failed its integrity check')
    expect(preview).not.toMatch(/\.insert\(|\.upsert\(|persistGenerated/)
  })

  it('returns enough server state to populate the Task 5 editor and review panel', () => {
    const list = routeSource('route.ts')
    for (const table of [
      'estate_clause_working_drafts',
      'estate_clause_revisions',
      'estate_clause_review_events',
      'estate_clause_publications',
    ]) {
      expect(list).toContain(`.from('${table}')`)
    }
    expect(list).toContain('workingDraft:')
    expect(list).toContain('submittedRevisions:')
    expect(list).toContain('currentPublication:')
    expect(list).toContain('validationReport:')
    expect(list).toContain('changeSummary:')
  })

  it('keeps AI drafting rate-limited, quoted, and outside workflow authority', () => {
    const ai = routeSource('draft-ai/route.ts')
    expect(ai).toContain('consumeRateLimit(')
    expect(ai).toContain("resolveFirmModel('drafting')")
    expect(ai).toContain('PROMPT_INJECTION_GUARDRAIL')
    expect(ai).toContain('quoteUserContent(')
    expect(ai).toContain('attorney-review draft')
    expect(ai).toContain('must not invent client facts')
    expect(ai).toContain('return Response.json({ proposal: { text } })')
    expect(ai).not.toMatch(/submitEstateClause|requestEstateClauseChanges|publishEstateClause/)
  })
})

describe.sequential('estate clause admin route runtime behavior', () => {
  const clauseId = '11111111-1111-4111-8111-111111111111'
  const revisionId = '22222222-2222-4222-8222-222222222222'
  const matterId = '33333333-3333-4333-8333-333333333333'

  it('short-circuits every handler when authentication fails', async () => {
    vi.resetModules()
    const requireAdmin = vi.fn().mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: null,
      user: null,
    })
    const getAdminClient = vi.fn()
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient }))
    vi.doMock('@/lib/anthropic', () => ({ callAnthropic: vi.fn(), PROMPT_INJECTION_GUARDRAIL: 'guardrail', quoteUserContent: vi.fn() }))
    vi.doMock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn() }))
    vi.doMock('@/lib/rateLimit', () => ({ consumeRateLimit: vi.fn() }))

    const [root, draft, submit, review, preview, ai] = await Promise.all([
      import('@/app/api/admin/settings/estate-clauses/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/draft/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/submit/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/review/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/preview/route'),
      import('@/app/api/admin/settings/estate-clauses/draft-ai/route'),
    ])
    const req = () => new Request('http://localhost/api', { method: 'POST', body: '{}' })
    const context = { params: Promise.resolve({ clauseId }) }
    const responses = await Promise.all([
      root.GET(req()), root.POST(req()), draft.PUT(req(), context), submit.POST(req(), context),
      review.POST(req(), context), preview.POST(req(), context), ai.POST(req()),
    ])

    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
    expect(requireAdmin).toHaveBeenCalledTimes(7)
    expect(getAdminClient).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed route identifiers and bodies before database access', async () => {
    vi.resetModules()
    const requireAdmin = vi.fn().mockResolvedValue({ err: null, userId: 'reviewer-1', user: { id: 'reviewer-1' } })
    const getAdminClient = vi.fn()
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient }))
    vi.doMock('@/lib/anthropic', () => ({ callAnthropic: vi.fn(), PROMPT_INJECTION_GUARDRAIL: 'guardrail', quoteUserContent: vi.fn() }))
    vi.doMock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn() }))
    vi.doMock('@/lib/rateLimit', () => ({ consumeRateLimit: vi.fn() }))

    const [root, draft, submit, review, preview, ai] = await Promise.all([
      import('@/app/api/admin/settings/estate-clauses/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/draft/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/submit/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/review/route'),
      import('@/app/api/admin/settings/estate-clauses/[clauseId]/preview/route'),
      import('@/app/api/admin/settings/estate-clauses/draft-ai/route'),
    ])
    const invalidContext = { params: Promise.resolve({ clauseId: 'not-a-uuid' }) }
    const json = (body: unknown) => new Request('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const responses = await Promise.all([
      root.POST(json({})),
      draft.PUT(json({}), invalidContext),
      submit.POST(json({}), invalidContext),
      review.POST(json({ action: 'publish', expectedCurrentRevisionId: null, unexpected: true }), invalidContext),
      preview.POST(json({ revisionId, matterId }), invalidContext),
      ai.POST(json({})),
    ])

    expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400, 400, 400])
    expect(getAdminClient).not.toHaveBeenCalled()
  })

  it('rejects ambiguous submitted revisions before any review RPC', async () => {
    vi.resetModules()
    const client = fakeClient({
      estate_clause_revisions: { data: [
        { id: revisionId, author_id: 'author-1', validation_status: 'valid' },
        { id: '44444444-4444-4444-8444-444444444444', author_id: 'author-2', validation_status: 'valid' },
      ], error: null },
      estate_clause_review_events: { data: [
        { revision_id: revisionId, event_type: 'submitted' },
        { revision_id: '44444444-4444-4444-8444-444444444444', event_type: 'submitted' },
      ], error: null },
    })
    const publish = vi.fn()
    const requestChanges = vi.fn()
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue({ err: null, userId: 'reviewer-1' }) }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => client }))
    vi.doMock('@/lib/estateClauses/repository', () => ({
      publishEstateClauseRevision: publish,
      requestEstateClauseChanges: requestChanges,
    }))
    const { POST } = await import('@/app/api/admin/settings/estate-clauses/[clauseId]/review/route')

    const response = await POST(new Request('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'publish', expectedCurrentRevisionId: null }),
    }), { params: Promise.resolve({ clauseId }) })

    expect(response.status).toBe(409)
    expect(publish).not.toHaveBeenCalled()
    expect(requestChanges).not.toHaveBeenCalled()
  })

  it('maps stale workflow RPC failures to 409', async () => {
    vi.resetModules()
    const client = fakeClient({
      estate_clause_revisions: { data: [{ id: revisionId, author_id: 'author-1', validation_status: 'valid' }], error: null },
      estate_clause_review_events: { data: [{ revision_id: revisionId, event_type: 'submitted' }], error: null },
      estate_clause_publications: { data: null, error: null },
    })
    const publish = vi.fn().mockRejectedValue(new Error('Revision is not awaiting review after a different publication'))
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue({ err: null, userId: 'reviewer-1' }) }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => client }))
    vi.doMock('@/lib/estateClauses/repository', () => ({
      publishEstateClauseRevision: publish,
      requestEstateClauseChanges: vi.fn(),
    }))
    const { POST } = await import('@/app/api/admin/settings/estate-clauses/[clauseId]/review/route')

    const response = await POST(new Request('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'publish', expectedCurrentRevisionId: null }),
    }), { params: Promise.resolve({ clauseId }) })

    expect(response.status).toBe(409)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for self-review and 404 when no submitted revision exists', async () => {
    const invoke = async (client: ReturnType<typeof fakeClient>, userId: string) => {
      vi.resetModules()
      const publish = vi.fn()
      vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue({ err: null, userId }) }))
      vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => client }))
      vi.doMock('@/lib/estateClauses/repository', () => ({
        publishEstateClauseRevision: publish,
        requestEstateClauseChanges: vi.fn(),
      }))
      const { POST } = await import('@/app/api/admin/settings/estate-clauses/[clauseId]/review/route')
      const response = await POST(new Request('http://localhost/api', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish', expectedCurrentRevisionId: null }),
      }), { params: Promise.resolve({ clauseId }) })
      return { response, publish }
    }

    const selfReview = await invoke(fakeClient({
      estate_clause_revisions: { data: [{ id: revisionId, author_id: 'author-1', validation_status: 'valid' }], error: null },
      estate_clause_review_events: { data: [{ revision_id: revisionId, event_type: 'submitted' }], error: null },
    }), 'author-1')
    expect(selfReview.response.status).toBe(403)
    expect(selfReview.publish).not.toHaveBeenCalled()

    const missing = await invoke(fakeClient({
      estate_clause_revisions: { data: [], error: null },
      estate_clause_review_events: { data: [], error: null },
    }), 'reviewer-1')
    expect(missing.response.status).toBe(404)
    expect(missing.publish).not.toHaveBeenCalled()
  })

  it('rejects a candidate hash mismatch before snapshot loading or generation', async () => {
    vi.resetModules()
    const client = fakeClient({
      estate_clause_revisions: { data: {
        id: revisionId,
        clause_id: clauseId,
        revision_number: 2,
        clause_text: 'Candidate text.',
        required_fields: [],
        nested_clause_keys: [],
        condition_field: null,
        content_hash: '0'.repeat(64),
        validation_status: 'valid',
        validation_report: { errors: [] },
        estate_clauses: { clause_key: 'will.candidate', title: 'Candidate', jurisdiction: 'MA', document_types: ['will'], is_active: true },
      }, error: null },
    })
    const loadSnapshot = vi.fn()
    const buildDraftPayload = vi.fn()
    const generate = vi.fn()
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue({ err: null, userId: 'reviewer-1' }) }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => client }))
    vi.doMock('@/lib/buildDraftPayload', () => ({ buildDraftPayload }))
    vi.doMock('@/lib/estateGenerator/node/generate', () => ({ generateEstatePlanDocumentsNode: generate }))
    vi.doMock('@/lib/estateClauses/repository', async () => {
      const actual = await vi.importActual<typeof import('@/lib/estateClauses/repository')>('@/lib/estateClauses/repository')
      return { ...actual, loadPublishedEstateClauseSnapshot: loadSnapshot }
    })
    const { POST } = await import('@/app/api/admin/settings/estate-clauses/[clauseId]/preview/route')

    const response = await POST(new Request('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revisionId, matterId }),
    }), { params: Promise.resolve({ clauseId }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Candidate revision failed its integrity check' })
    expect(loadSnapshot).not.toHaveBeenCalled()
    expect(buildDraftPayload).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  })

  it('rejects a preview whose generated manifests omit the candidate without persistence', async () => {
    vi.resetModules()
    const content = { text: 'Candidate text.', requiredFields: [], nestedClauseKeys: [], conditionField: null }
    const client = fakeClient({
      estate_clause_revisions: { data: {
        id: revisionId,
        clause_id: clauseId,
        revision_number: 2,
        clause_text: content.text,
        required_fields: content.requiredFields,
        nested_clause_keys: content.nestedClauseKeys,
        condition_field: content.conditionField,
        content_hash: hashEstateClauseContent(content),
        validation_status: 'valid',
        validation_report: { errors: [] },
        estate_clauses: { clause_key: 'will.candidate', title: 'Candidate', jurisdiction: 'MA', document_types: ['will'], is_active: true },
      }, error: null },
    })
    const loadSnapshot = vi.fn().mockResolvedValue({ jurisdiction: 'MA', clauses: new Map(), overrides: new Map(), source: 'database' })
    const buildDraftPayload = vi.fn().mockResolvedValue({ client: { state: 'MA' } })
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      files: [{ name: 'will.docx', buffer: Buffer.from('docx'), clauseManifest: [], unresolvedMarkers: [] }],
      missing: [], warnings: [], packageName: 'simple-will', packageNames: ['simple-will'], clientSlug: 'client',
    })
    vi.doMock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn().mockResolvedValue({ err: null, userId: 'reviewer-1' }) }))
    vi.doMock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => client }))
    vi.doMock('@/lib/buildDraftPayload', () => ({ buildDraftPayload }))
    vi.doMock('@/lib/estateGenerator/node/generate', () => ({ generateEstatePlanDocumentsNode: generate }))
    vi.doMock('@/lib/estateClauses/repository', async () => {
      const actual = await vi.importActual<typeof import('@/lib/estateClauses/repository')>('@/lib/estateClauses/repository')
      return { ...actual, loadPublishedEstateClauseSnapshot: loadSnapshot }
    })
    const { POST } = await import('@/app/api/admin/settings/estate-clauses/[clauseId]/preview/route')

    const response = await POST(new Request('http://localhost/api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revisionId, matterId }),
    }), { params: Promise.resolve({ clauseId }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Candidate revision did not appear in any generated document' })
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    expect(buildDraftPayload).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(routeSource('[clauseId]/preview/route.ts')).not.toMatch(/\.insert\(|\.upsert\(|persistGenerated/)
  })
})
