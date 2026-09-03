import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PizZip from 'pizzip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import type {
  EstateClauseOverride,
  EstateClauseSnapshot,
  PublishedEstateClause,
  EstateDocumentType,
} from '@/lib/estateClauses/types'

const mocks = vi.hoisted(() => ({
  loadEstateClauseSnapshot: vi.fn(),
}))

vi.mock('@/lib/estateClauses/source', () => ({
  loadEstateClauseSnapshot: mocks.loadEstateClauseSnapshot,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ mocked: true }),
}))

vi.mock('@/lib/estateGenerator/toGeneratorData', () => ({
  clientSlugFromPayload: () => 'jane-example',
  deriveEstateGeneratorPackages: () => [
    'testamentary-trust-will',
    'incapacity-documents',
    'estate-plan-summary',
  ],
  estateGeneratorBlockingError: () => null,
  estateGeneratorCoverageWarnings: () => [],
  toEstateGeneratorData: () => ({
    client: {
      full_name: 'Jane Example',
      first_name: 'Jane',
      last_name: 'Example',
      state: 'MA',
      county: 'Suffolk',
      city: 'Boston',
      street_address: '123 Main Street',
      date_of_birth: '1970-01-01',
    },
    trust: { name: 'Jane Example Revocable Trust' },
    planning: { uses_revocable_trust: true },
    fiduciaries: {},
    healthcare: {},
    children: [],
    execution: {},
  }),
}))

import {
  generateEstatePlanDocumentsNode,
  generateNodeEstatePackage,
} from '@/lib/estateGenerator/node/generate'
import { persistGeneratedEstateDocument } from '@/lib/estateClauses/persistGeneratedDocument'
import { createNodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import { bundledTemplateResolver } from '@aubrey-law/drafting-engine/estateGenerator/node/generate'
import { DEFAULT_STYLE_SET } from '@aubrey-law/drafting-engine/styleSets/defaults'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

function documentXml(buffer: Buffer): string {
  return new PizZip(buffer).files['word/document.xml'].asText()
}

function publication(args: {
  clauseKey: string
  revisionId: string
  contentHash: string
  text: string
  conditionField?: string | null
  nestedClauseKeys?: string[]
  documentTypes?: EstateDocumentType[]
}): PublishedEstateClause {
  return {
    clauseId: args.clauseKey,
    clauseKey: args.clauseKey,
    title: args.clauseKey,
    jurisdiction: 'MA',
    documentTypes: args.documentTypes ?? ['will'],
    revisionId: args.revisionId,
    revisionNumber: 1,
    contentHash: args.contentHash,
    reviewStatus: 'approved',
    text: args.text,
    requiredFields: [],
    nestedClauseKeys: args.nestedClauseKeys ?? [],
    conditionField: args.conditionField ?? null,
  }
}

function databaseSnapshot(revisionSuffix: 'a' | 'b'): EstateClauseSnapshot {
  const bundled = loadBundledEstateClauseSnapshot({
    root,
    jurisdiction: 'MA',
    allowDraft: true,
  })
  const clauses = new Map(bundled.clauses)
  clauses.set('will.tangible_personal_property', publication({
    clauseKey: 'will.tangible_personal_property',
    revisionId: `revision-tangible-property-${revisionSuffix}`,
    contentHash: revisionSuffix.repeat(64),
    conditionField: 'publication_condition_that_is_false',
    nestedClauseKeys: ['nested.audit'],
    text: `Tangible-property publication ${revisionSuffix.toUpperCase()} {{ include_clause("nested.audit") }}`,
  }))
  clauses.set('nested.audit', publication({
    clauseKey: 'nested.audit',
    revisionId: `revision-nested-${revisionSuffix}`,
    contentHash: revisionSuffix.repeat(64),
    text: `Nested publication ${revisionSuffix.toUpperCase()}`,
  }))

  const override: EstateClauseOverride = {
    id: 'override-tangible-property',
    clauseId: 'will.tangible_personal_property',
    clauseKey: 'will.tangible_personal_property',
    action: 'force_include',
    reason: 'Attorney determined this conditional clause is required.',
    actorId: 'attorney-1',
  }

  return {
    jurisdiction: 'MA',
    clauses,
    overrides: new Map([[override.clauseKey, override]]),
    source: 'database',
  }
}

describe('estate clause generation provenance', () => {
  beforeEach(() => {
    mocks.loadEstateClauseSnapshot.mockReset()
  })

  it('fails closed when a nested include is incompatible with the target document type', () => {
    const rootClause = publication({
      clauseKey: 'will.root', revisionId: 'root-revision', contentHash: 'a'.repeat(64),
      text: '{{ include_clause("trust.child") }}', nestedClauseKeys: ['trust.child'], documentTypes: ['will'],
    })
    const childClause = publication({
      clauseKey: 'trust.child', revisionId: 'child-revision', contentHash: 'b'.repeat(64),
      text: 'Trust-only text.', documentTypes: ['trust'],
    })
    const store = createNodeClauseStore({
      state: 'MA', documentTypes: ['will'],
      snapshot: { jurisdiction: 'MA', clauses: new Map([[rootClause.clauseKey, rootClause], [childClause.clauseKey, childClause]]), overrides: new Map(), source: 'database' },
    })
    expect(() => store.include('will.root', {} as never)).toThrow(
      'Published clause trust.child is incompatible with target document type(s): will',
    )
  })

  it('freezes one publication snapshot and records isolated per-document manifests', async () => {
    const firstSnapshot = databaseSnapshot('a')
    const laterSnapshot = databaseSnapshot('b')
    mocks.loadEstateClauseSnapshot
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValue(laterSnapshot)

    const result = await generateEstatePlanDocumentsNode({
      client: { state: 'MA' },
    } as never, { matterId: 'matter-1' })

    if (!result.ok) throw new Error(result.error)
    expect(result.ok).toBe(true)

    expect(mocks.loadEstateClauseSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.loadEstateClauseSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      matterId: 'matter-1',
      jurisdiction: 'MA',
    }))

    for (const file of result.files) {
      expect(file.clauseSource).toBe('database')
      expect(file.clauseManifest.map(entry => entry.inclusionPosition))
        .toEqual(file.clauseManifest.map((_, index) => index))
      expect(file.clauseManifest.every(entry => !entry.revisionId.endsWith('-b'))).toBe(true)
    }

    const willFile = result.files.find(file => file.name === '01-testamentary-trust-will.docx')
    expect(willFile).toBeDefined()
    const willXml = documentXml(willFile!.buffer)
    expect(willXml).toContain('Tangible-property publication A')
    expect(willXml).toContain('Nested publication A')
    expect(willXml).not.toContain('publication B')
    expect(willFile?.clauseManifest.map(entry => entry.clauseKey)).toContain('nested.audit')
    const forcedEntry = willFile?.clauseManifest.find(entry => entry.clauseKey === 'will.tangible_personal_property')
    expect(forcedEntry).toMatchObject({
      clauseId: 'will.tangible_personal_property',
      revisionId: 'revision-tangible-property-a',
      selectionReason: 'attorney_override',
      overrideId: 'override-tangible-property',
    })
    const nestedEntry = willFile?.clauseManifest.find(entry => entry.clauseKey === 'nested.audit')
    expect(nestedEntry).toMatchObject({
      clauseId: 'nested.audit',
      revisionId: 'revision-nested-a',
      selectionReason: 'template_rule',
      overrideId: null,
    })

    expect(willFile?.clauseManifest.length).toBeGreaterThan(0)
    expect(willFile?.clauseManifest.every(entry => (
      entry.clauseKey.startsWith('will.')
      || entry.clauseKey.startsWith('testamentary_will.')
      || entry.clauseKey.startsWith('execution.')
      || entry.clauseKey === 'nested.audit'
    ))).toBe(true)

    const healthCareProxy = result.files.find(file => file.name === '02-health-care-proxy.docx')
    expect(healthCareProxy?.clauseManifest).toEqual([])
    const durablePoa = result.files.find(file => file.name === '01-durable-power-of-attorney.docx')
    expect(durablePoa?.clauseManifest).toEqual([])

    const summaryFile = result.files.find(file => file.name === '00-estate-plan-summary.docx')
    expect(summaryFile?.clauseManifest).toEqual([])
  })

  it('starts a fresh manifest for every DOCX in one package', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'estate-clause-manifest-'))
    fs.mkdirSync(path.join(temporaryRoot, 'packages'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, 'templates'), { recursive: true })
    fs.mkdirSync(path.join(temporaryRoot, 'states', 'MA'), { recursive: true })
    fs.writeFileSync(path.join(temporaryRoot, 'states', 'MA', 'rules.json'), '{}')
    fs.writeFileSync(path.join(temporaryRoot, 'packages', 'incapacity-documents.json'), JSON.stringify({
      name: 'incapacity-documents',
      required_fields: [],
      documents: [
        { id: 'durable-power-of-attorney', title: 'With Clause', template: 'templates/with-clause.docx', output: '01-with-clause.docx' },
        { id: 'hipaa', title: 'Without Clause', template: 'templates/without-clause.docx', output: '02-without-clause.docx' },
      ],
    }))

    const template = (body: string) => {
      const zip = new PizZip()
      zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`)
      return Buffer.from(zip.generate({ type: 'uint8array' }))
    }
    fs.writeFileSync(
      path.join(temporaryRoot, 'templates', 'with-clause.docx'),
      template('{{ include_clause("nested.audit") }}'),
    )
    fs.writeFileSync(
      path.join(temporaryRoot, 'templates', 'without-clause.docx'),
      template('No clause here.'),
    )

    const nested = publication({
      clauseKey: 'nested.audit',
      revisionId: 'revision-nested-a',
      contentHash: 'a'.repeat(64),
      text: 'Nested publication A',
      documentTypes: ['durable_power_of_attorney'],
    })
    const snapshot: EstateClauseSnapshot = {
      jurisdiction: 'MA',
      clauses: new Map([[nested.clauseKey, nested]]),
      overrides: new Map(),
      source: 'database',
    }

    try {
      const result = await generateNodeEstatePackage({
        templateResolver: bundledTemplateResolver,
        styleSet: DEFAULT_STYLE_SET,
        data: { client: { full_name: 'Jane Example', state: 'MA' }, children: [], execution: {} },
        packageName: 'incapacity-documents',
        state: 'MA',
        root: temporaryRoot,
        clauseSnapshot: snapshot,
      })

      if (!result.ok) throw new Error(result.error)
      expect(result.files[0].clauseManifest).toEqual([expect.objectContaining({
        clauseKey: 'nested.audit',
        inclusionPosition: 0,
      })])
      expect(result.files[1].clauseManifest).toEqual([])
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})

describe('estate clause provenance persistence', () => {
  it('sends the document metadata and exact manifest through one RPC', async () => {
    const manifest = [{
      clauseId: '11111111-1111-4111-8111-111111111111',
      clauseKey: 'will.executor_appointment',
      revisionId: '22222222-2222-4222-8222-222222222222',
      contentHash: 'a'.repeat(64),
      inclusionPosition: 0,
      selectionReason: 'template_rule' as const,
      overrideId: null,
      included: true,
      overrideAction: null,
    }]
    const document = {
      matter_id: '33333333-3333-4333-8333-333333333333',
      r2_key: 'matters/333/draft/will.docx',
      name: 'Will.docx',
      size: 1234,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source: 'firm' as const,
      actor_id: '44444444-4444-4444-8444-444444444444',
      generation_id: '55555555-5555-4555-8555-555555555555',
      generation_engine: 'node' as const,
      marker_count: 0,
      missing_count: 0,
      template_id: 'testamentary-trust-will',
      template_version_id: null,
    }
    const rpc = vi.fn().mockResolvedValue({
      data: { documentId: 'document-1', documentVersionId: 'version-1' },
      error: null,
    })

    await expect(persistGeneratedEstateDocument({ admin: { rpc }, document, manifest }))
      .resolves.toEqual({ documentId: 'document-1', documentVersionId: 'version-1' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('persist_generated_estate_document', {
      p_document: document,
      p_manifest: manifest,
    })
    expect(rpc.mock.calls[0]?.[1]?.p_manifest).toBe(manifest)
  })

  it('persists a durable force-omit decision with its immutable override event', async () => {
    const manifest = [{
      clauseId: '11111111-1111-4111-8111-111111111111', clauseKey: 'will.pet_care',
      revisionId: '22222222-2222-4222-8222-222222222222', contentHash: 'b'.repeat(64),
      inclusionPosition: null, selectionReason: 'attorney_override' as const,
      overrideId: '33333333-3333-4333-8333-333333333333', included: false,
      overrideAction: 'force_omit' as const,
    }]
    const document = {
      matter_id: '44444444-4444-4444-8444-444444444444', r2_key: 'draft/will.docx', name: 'Will.docx',
      size: 1, content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source: 'firm' as const, actor_id: '55555555-5555-4555-8555-555555555555',
      generation_id: '66666666-6666-4666-8666-666666666666', generation_engine: 'node' as const,
      marker_count: 0, missing_count: 0, template_id: null, template_version_id: null,
    }
    const rpc = vi.fn().mockResolvedValue({ data: { documentId: 'd', documentVersionId: 'v' }, error: null })
    await persistGeneratedEstateDocument({ admin: { rpc }, document, manifest })
    expect(rpc).toHaveBeenCalledWith('persist_generated_estate_document', { p_document: document, p_manifest: manifest })
  })

  it('fails closed on RPC errors or missing identifiers', async () => {
    const base = {
      document: {
        matter_id: '33333333-3333-4333-8333-333333333333',
        r2_key: 'matter.docx',
        name: 'Matter.docx',
        size: 1,
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: 'firm' as const,
        actor_id: '44444444-4444-4444-8444-444444444444',
        generation_id: '55555555-5555-4555-8555-555555555555',
        generation_engine: 'node' as const,
        marker_count: 0,
        missing_count: 0,
        template_id: null,
        template_version_id: null,
      },
      manifest: [],
    }

    await expect(persistGeneratedEstateDocument({
      ...base,
      admin: { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'transaction rolled back' } }) },
    })).rejects.toThrow('transaction rolled back')
    await expect(persistGeneratedEstateDocument({
      ...base,
      admin: { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    })).rejects.toThrow('returned no identifiers')
  })

  it('defines one transactional RPC for document, version, manifest, and current pointer', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'), 'utf8')
    const rpc = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_generated_estate_document'),
      sql.indexOf('ALTER TABLE public.estate_clauses ENABLE ROW LEVEL SECURITY'),
    )

    expect(rpc).toContain('INSERT INTO public.matter_documents')
    expect(rpc).toContain('INSERT INTO public.document_versions')
    expect(rpc).toContain('INSERT INTO public.generated_document_clause_revisions')
    expect(rpc).toContain('SET current_version_id = v_document_version_id')
    expect(rpc).toContain("e.event_type = 'published'")
    expect(rpc).not.toContain('p.current_revision_id = v_revision_id')
  })
})
