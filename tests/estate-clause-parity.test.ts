import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import { runtimeReadonlyMap, type EstateClauseClient } from '@/lib/estateClauses/repository'
import type { EstateClauseOverride, EstateClauseSnapshot } from '@/lib/estateClauses/types'
import { estateClauseSource, loadEstateClauseSnapshot } from '@/lib/estateClauses/source'
import { referencedClauseKeys } from '@/lib/estateClauses/templateReferences'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { isPresent, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')
const cutoverFixturePath = path.join(process.cwd(), 'tests/fixtures/estate-clause-database-cutover.json')

interface CutoverPublication {
  clauseKey: string
  reviewStatus: string
  contentHash: string
  text: string
}

interface CutoverFixture {
  capturedFrom: string
  stagedClauseKeys: string[]
  activePublications: CutoverPublication[]
}

const representativeTemplateNames = [
  'will.docx',
  'joint-trust.docx',
  'durable-power-of-attorney.docx',
  'health-care-proxy.docx',
  'hipaa-authorization.docx',
] as const

// Any approved difference must name the stable clause key and explain why the
// database publication intentionally differs from the rollback file source.
const intentionalDifferences: Readonly<Record<string, string>> = {}

interface LegacyClause {
  id: string
  title: string
  document_type: string
  jurisdiction: string
  condition?: string | null
  required_fields?: string[]
  review_status?: string
  text: string
  _source_file: string
}

function readClauses(directory: string): Map<string, LegacyClause> {
  const clauses = new Map<string, LegacyClause>()
  if (!fs.existsSync(directory)) return clauses
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
    const filePath = path.join(directory, filename)
    const clause = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LegacyClause
    clause._source_file = path.relative(root, filePath)
    clauses.set(clause.id, clause)
  }
  return clauses
}

function effectiveLegacyClauses() {
  return new Map([
    ...readClauses(path.join(root, 'clauses')),
    ...readClauses(path.join(root, 'states', 'MA', 'clauses')),
  ])
}

function databaseClient(results: Record<string, { data: unknown; error: { message: string } | null }>): EstateClauseClient {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null }
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        upsert: () => query,
        insert: () => query,
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      }
      return query
    },
    rpc(name: string) {
      const direct = results[name]
      if (direct) return Promise.resolve(direct)
      if (name === 'load_estate_clause_generation_snapshot') {
        const publicationsResult = results.estate_clause_publications ?? { data: [], error: null }
        if (publicationsResult.error) return Promise.resolve(publicationsResult)
        const publications = (publicationsResult.data as Array<{
          clause_id: string
          current_revision_id: string
          estate_clauses: { clause_key: string; title: string; jurisdiction: string; document_types: string[] }
          estate_clause_revisions: {
            revision_number: number
            clause_text: string
            required_fields: string[]
            nested_clause_keys: string[]
            condition_field: string | null
            content_hash: string
          }
        }>).map(row => ({
          clause_id: row.clause_id,
          current_revision_id: row.current_revision_id,
          clause_key: row.estate_clauses.clause_key,
          title: row.estate_clauses.title,
          jurisdiction: row.estate_clauses.jurisdiction,
          document_types: row.estate_clauses.document_types,
          revision_number: row.estate_clause_revisions.revision_number,
          clause_text: row.estate_clause_revisions.clause_text,
          required_fields: row.estate_clause_revisions.required_fields,
          nested_clause_keys: row.estate_clause_revisions.nested_clause_keys,
          condition_field: row.estate_clause_revisions.condition_field,
          content_hash: row.estate_clause_revisions.content_hash,
        }))
        return Promise.resolve({ data: { publications, overrides: [] }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  } as EstateClauseClient
}

afterEach(() => {
  delete process.env.ESTATE_CLAUSE_SOURCE
})

describe('bundled estate clause adapter parity', () => {
  it('maps every effective bundled key to an immutable synthetic publication without strict-DSL rejection', () => {
    const legacy = effectiveLegacyClauses()
    const snapshot = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })

    expect([...snapshot.clauses.keys()].sort()).toEqual([...legacy.keys()].sort())
    for (const [key, source] of legacy) {
      expect(snapshot.clauses.get(key), key).toMatchObject({
        clauseId: key,
        clauseKey: key,
        title: source.title,
        jurisdiction: 'MA',
        documentTypes: [source.document_type],
        text: source.text,
        requiredFields: source.required_fields ?? [],
        conditionField: source.condition ?? null,
        reviewStatus: source.review_status ?? 'draft',
        sourceFile: source._source_file,
        sourceJurisdiction: source.jurisdiction,
      })
      expect(snapshot.clauses.get(key)?.revisionId).toBe(`file:${snapshot.clauses.get(key)?.contentHash}`)
    }
    expect(() => (snapshot.clauses as Map<string, unknown>).clear()).toThrow('ReadonlyMap cannot be mutated')
  })

  it('uses state publications over base publications and renders nested clauses from the same snapshot', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), '.estate-clause-parity-'))
    const writeClause = (relativePath: string, value: Record<string, unknown>) => {
      const filePath = path.join(fixtureRoot, relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(value))
    }
    const clause = (id: string, text: string) => ({
      id,
      title: id,
      document_type: 'will',
      jurisdiction: 'base',
      review_status: 'approved',
      text,
    })

    try {
      writeClause('clauses/parent.json', clause('parent', 'Parent: {{ include_clause("child") }}'))
      writeClause('clauses/child.json', clause('child', 'BASE'))
      writeClause('states/MA/clauses/child.json', {
        ...clause('child', 'STATE'),
        jurisdiction: 'MA',
      })

      const snapshot = loadBundledEstateClauseSnapshot({ root: fixtureRoot, jurisdiction: 'MA' })
      const store = createNodeClauseStore({ snapshot, state: 'MA' })
      expect(store.include('parent', {} as never)).toBe('Parent: STATE')
      expect(snapshot.clauses.get('child')).toMatchObject({
        text: 'STATE',
        sourceFile: path.join('states', 'MA', 'clauses', 'child.json'),
        sourceJurisdiction: 'MA',
      })
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('does not reveal an approved base clause when the winning state publication is draft', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), '.estate-clause-parity-'))
    const writeClause = (relativePath: string, reviewStatus: string, text: string) => {
      const filePath = path.join(fixtureRoot, relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify({
        id: 'conditional.key',
        title: 'Conditional clause',
        document_type: 'will',
        jurisdiction: relativePath.startsWith('states/') ? 'MA' : 'base',
        condition: 'has_children',
        review_status: reviewStatus,
        text,
      }))
    }

    try {
      writeClause('clauses/conditional.key.json', 'approved', 'BASE APPROVED')
      writeClause('states/MA/clauses/conditional.key.json', 'draft', 'STATE DRAFT')
      const snapshot = loadBundledEstateClauseSnapshot({ root: fixtureRoot, jurisdiction: 'MA' })

      expect(snapshot.clauses.has('conditional.key')).toBe(false)
      expect(() => createNodeClauseStore({ snapshot, state: 'MA' })
        .include('conditional.key', { has_children: true } as never))
        .toThrow('Clause conditional.key is marked "draft". Use allowDraft to generate draft documents.')
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('propagates an actionable warning for bundled JSON without an id', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(process.cwd(), '.estate-clause-parity-'))
    const filePath = path.join(fixtureRoot, 'clauses', 'missing-id.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify({ title: 'Missing ID', text: 'Ignored.' }))

    try {
      const snapshot = loadBundledEstateClauseSnapshot({ root: fixtureRoot, jurisdiction: 'MA' })
      const store = createNodeClauseStore({ snapshot, state: 'MA' })
      expect(store.report.warnings).toEqual([`Clause file has no id and was ignored: ${filePath}`])
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('preserves legacy inclusion, skipping, missing markers, reports, state lookup warnings, and nested rendering', () => {
    const legacy = effectiveLegacyClauses()
    const snapshot = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
    const context = buildNodeEstateContext({
      data: {
        client: { full_name: '', state: 'MA', county: 'Suffolk' },
        planning: { uses_revocable_trust: false },
        children: [],
        execution: {},
      },
      state: 'MA',
      root,
    })

    for (const [key, source] of legacy) {
      const store = createNodeClauseStore({ snapshot, state: 'MA', allowDraft: true })
      const expectedSkipped = Boolean(source.condition && !isPresent(context[source.condition]))
      const expected = expectedSkipped ? '' : renderNodeEstateText(source.text, context, {
        include_clause: (nestedKey: string) => {
          const nested = legacy.get(nestedKey)
          if (!nested) throw new Error(`Clause not found: ${nestedKey}`)
          return renderNodeEstateText(nested.text, context)
        },
      })

      expect(store.include(key, context, 'NY'), key).toBe(expected)
      expect(store.report.warnings).toEqual([`Requested clause ${key} for state NY; active state is MA.`])
      if (expectedSkipped) {
        expect(store.report.skipped_clauses).toEqual([{
          id: key,
          reason: `condition false: ${source.condition}`,
          source: source._source_file,
        }])
      } else {
        expect(store.report.included_clauses).toEqual([expect.objectContaining({
          id: key,
          title: source.title,
          jurisdiction: source.jurisdiction,
          source: source._source_file,
          review_status: source.review_status ?? 'draft',
          selection_reason: 'template_rule',
          override_id: null,
        })])
        expect(store.report.missing_fields).toEqual(missingRequiredFields(context, source.required_fields ?? []))
      }
    }
  })
})

describe('snapshot-backed clause selection', () => {
  function withOverride(override: EstateClauseOverride): EstateClauseSnapshot {
    const snapshot = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
    return {
      ...snapshot,
      overrides: runtimeReadonlyMap(new Map([[override.clauseKey, override]])),
    }
  }

  it('force-includes before condition evaluation and records attorney provenance', () => {
    const clause = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
      .clauses.get('trust.spendthrift')!
    const snapshot = withOverride({
      id: 'override-include',
      clauseId: clause.clauseId,
      clauseKey: clause.clauseKey,
      action: 'force_include',
      reason: 'Include for this matter.',
      actorId: 'attorney-1',
    })
    const store = createNodeClauseStore({ snapshot, state: 'MA', allowDraft: true })

    expect(store.include(clause.clauseKey, { uses_revocable_trust: false } as never)).toContain('No beneficiary')
    expect(store.report.included_clauses).toEqual([expect.objectContaining({
      selection_reason: 'attorney_override',
      override_id: 'override-include',
    })])
  })

  it('force-omits a conditional clause before condition evaluation and records attorney provenance', () => {
    const clause = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
      .clauses.get('trust.spendthrift')!
    const snapshot = withOverride({
      id: 'override-omit',
      clauseId: clause.clauseId,
      clauseKey: clause.clauseKey,
      action: 'force_omit',
      reason: 'Omit for this matter.',
      actorId: 'attorney-1',
    })
    const store = createNodeClauseStore({ snapshot, state: 'MA', allowDraft: true })

    expect(store.include(clause.clauseKey, {} as never)).toBe('')
    expect(store.report.skipped_clauses).toEqual([expect.objectContaining({
      reason: 'attorney override: Omit for this matter.',
      selection_reason: 'attorney_override',
      override_id: 'override-omit',
    })])
  })

  it('rejects an override targeting an unconditional mandatory publication', () => {
    const clause = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
      .clauses.get('will.executor_appointment')!
    const snapshot = withOverride({
      id: 'override-unconditional',
      clauseId: clause.clauseId,
      clauseKey: clause.clauseKey,
      action: 'force_omit',
      reason: 'Invalid mandatory-clause omission.',
      actorId: 'attorney-1',
    })

    expect(() => createNodeClauseStore({ snapshot, state: 'MA', allowDraft: true }))
      .toThrow('Estate clause override override-unconditional cannot target unconditional publication will.executor_appointment')
  })

  it('rejects overrides without matching publications and creates a fresh report per store', () => {
    const base = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
    const missing = withOverride({
      id: 'override-missing',
      clauseId: 'missing-id',
      clauseKey: 'missing.key',
      action: 'force_include',
      reason: 'Invalid fixture.',
      actorId: 'attorney-1',
    })
    expect(() => createNodeClauseStore({ snapshot: missing, state: 'MA', allowDraft: true }))
      .toThrow('Estate clause override override-missing references a missing publication: missing.key')

    const first = createNodeClauseStore({ snapshot: base, state: 'MA', allowDraft: true })
    const second = createNodeClauseStore({ snapshot: base, state: 'MA', allowDraft: true })
    first.include('will.disclaimer', {} as never)
    expect(first.report).not.toBe(second.report)
    expect(second.report.included_clauses).toEqual([])
  })
})

describe('estate clause source selection', () => {
  it('defaults to file and selects database only for the exact database flag', () => {
    expect(estateClauseSource()).toBe('file')
    process.env.ESTATE_CLAUSE_SOURCE = 'DATABASE'
    expect(estateClauseSource()).toBe('file')
    process.env.ESTATE_CLAUSE_SOURCE = 'database'
    expect(estateClauseSource()).toBe('database')
  })

  it('does not fall back to bundled clauses when a database publication is missing', async () => {
    process.env.ESTATE_CLAUSE_SOURCE = 'database'
    const snapshot = await loadEstateClauseSnapshot({
      client: databaseClient({}),
      matterId: 'matter-1',
      jurisdiction: 'MA',
      root,
      allowDraft: true,
    })

    expect(snapshot.source).toBe('database')
    expect(snapshot.clauses.size).toBe(0)
    expect(() => createNodeClauseStore({ snapshot, state: 'MA', allowDraft: true })
      .include('will.executor_appointment', {} as never)).toThrow('Clause not found: will.executor_appointment')
  })

  it('does not fall back when a database publication is corrupt', async () => {
    process.env.ESTATE_CLAUSE_SOURCE = 'database'
    await expect(loadEstateClauseSnapshot({
      client: databaseClient({
        estate_clause_publications: {
          data: [{
            clause_id: 'clause-1',
            current_revision_id: 'revision-1',
            estate_clauses: { clause_key: 'will.executor_appointment', title: 'Executor', jurisdiction: 'MA', document_types: ['will'] },
            estate_clause_revisions: {
              revision_number: 1,
              clause_text: 'Corrupt publication',
              required_fields: [],
              nested_clause_keys: [],
              condition_field: null,
              content_hash: '0'.repeat(64),
            },
          }],
          error: null,
        },
      }),
      matterId: 'matter-1',
      jurisdiction: 'MA',
      root,
      allowDraft: true,
    })).rejects.toThrow('Published clause will.executor_appointment failed its integrity check')
  })
})

describe('estate clause release gate', () => {
  it('keeps privileged RPCs service-role-only with a fixed search path', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'),
      'utf8',
    )
    const tablePolicies: Readonly<Record<string, string>> = {
      estate_clauses: 'estate_clauses_staff_read',
      estate_clause_working_drafts: 'estate_clause_drafts_attorney_read',
      estate_clause_revisions: 'estate_clause_revisions_authorized_read',
      estate_clause_review_events: 'estate_clause_review_events_attorney_read',
      estate_clause_publications: 'estate_clause_publications_staff_read',
      estate_clause_preview_evidence: 'estate_clause_preview_evidence_attorney_read',
      matter_estate_clause_overrides: 'matter_estate_clause_overrides_attorney_read',
      generated_document_clause_revisions: 'generated_document_clause_revisions_staff_read',
    }
    const rpcs = [
      'submit_estate_clause_revision(uuid, uuid)',
      'request_estate_clause_changes(uuid, uuid, text)',
      'publish_estate_clause_revision(uuid, uuid, uuid)',
      'record_estate_clause_preview(uuid, text, text[], uuid, jsonb, uuid)',
      'retire_estate_clause_publication(uuid, uuid, text, uuid)',
      'revert_estate_clause_publication(uuid, uuid, uuid, text, uuid)',
      'upsert_matter_estate_clause_override(uuid, uuid, uuid, text, text, uuid)',
      'retire_matter_estate_clause_override(uuid, uuid, text, uuid)',
      'load_estate_clause_generation_snapshot(uuid)',
      'persist_generated_estate_document(jsonb, jsonb)',
    ]

    for (const [table, policy] of Object.entries(tablePolicies)) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`)
      expect(migration).toContain(`GRANT SELECT ON public.${table} TO authenticated`)
      expect(migration).toContain(`GRANT ALL ON public.${table} TO service_role`)
      expect(migration).toContain(`CREATE POLICY ${policy}\n  ON public.${table} FOR SELECT TO authenticated`)
    }
    expect(migration.match(/SECURITY DEFINER(?:\n| )SET search_path = ''/g)).toHaveLength(rpcs.length)
    for (const signature of rpcs) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated`)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`)
      expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO PUBLIC`)
      expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`)
      expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO anon`)
    }
  })

  it('database cutover readiness', () => {
    const fixture = JSON.parse(fs.readFileSync(cutoverFixturePath, 'utf8')) as CutoverFixture
    const bundled = loadBundledEstateClauseSnapshot({ root, jurisdiction: 'MA', allowDraft: true })
    const publications = new Map(fixture.activePublications.map(publication => [publication.clauseKey, publication]))
    const referenced = new Set<string>()

    for (const templateName of representativeTemplateNames) {
      const template = fs.readFileSync(path.join(root, 'templates', templateName))
      for (const clauseKey of referencedClauseKeys(template)) referenced.add(clauseKey)
    }

    expect(fixture.stagedClauseKeys, 'the local import rehearsal must stage all bundled clause keys')
      .toEqual([...bundled.clauses.keys()].sort())

    const missingPublications = [...referenced].filter(clauseKey => !publications.has(clauseKey)).sort()
    const draftPublications = fixture.activePublications
      .filter(publication => publication.reviewStatus === 'draft')
      .map(publication => publication.clauseKey)
      .sort()
    const unexplainedDifferences = fixture.activePublications.flatMap(publication => {
      const fileClause = bundled.clauses.get(publication.clauseKey)
      if (fileClause?.contentHash === publication.contentHash && fileClause.text === publication.text) return []
      return intentionalDifferences[publication.clauseKey] ? [] : [publication.clauseKey]
    }).sort()
    const staleDifferenceApprovals = Object.keys(intentionalDifferences)
      .filter(clauseKey => {
        const publication = publications.get(clauseKey)
        const fileClause = bundled.clauses.get(clauseKey)
        return !publication || (publication.contentHash === fileClause?.contentHash && publication.text === fileClause?.text)
      })
      .sort()

    expect({
      fixture: fixture.capturedFrom,
      missingPublications,
      draftPublications,
      unexplainedDifferences,
      staleDifferenceApprovals,
    }).toEqual({
      fixture: fixture.capturedFrom,
      missingPublications: [],
      draftPublications: [],
      unexplainedDifferences: [],
      staleDifferenceApprovals: [],
    })
  })
})
