import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import { runtimeReadonlyMap, type EstateClauseClient } from '@/lib/estateClauses/repository'
import type { EstateClauseOverride, EstateClauseSnapshot } from '@/lib/estateClauses/types'
import { estateClauseSource, loadEstateClauseSnapshot } from '@/lib/estateClauses/source'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { isPresent, missingRequiredFields } from '@/lib/estateGenerator/node/validation'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

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
    rpc: () => Promise.resolve({ data: null, error: null }),
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
