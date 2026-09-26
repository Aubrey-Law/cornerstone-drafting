import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import { makeFakeClient } from './helpers/fakeSupabase'

const fake = vi.hoisted(() => ({ client: null as unknown, written: [] as string[], removed: [] as string[] }))

vi.mock('@/lib/storage/r2', () => ({
  writeObject: vi.fn(async (key: string) => {
    fake.written.push(key)
  }),
  deleteObject: vi.fn(async (key: string) => {
    fake.removed.push(key)
  }),
  readObject: vi.fn(async () => Buffer.from('filed')),
}))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: () => fake.client }))
vi.mock('@/lib/auth/requireStaff', () => ({
  requireStaff: vi.fn(async () => ({ error: null, user: { id: 'user-1', email: 'a@aubreylegal.com', role: 'attorney' } })),
}))
vi.mock('@/lib/anthropic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/anthropic')>()),
  anthropicModelCaller: vi.fn(() => async () => ({ content: [] })),
}))
vi.mock('@/lib/runs/enqueue', () => ({ pokeTick: vi.fn(async () => undefined) }))

const TEXT = 'The Trustee shall serve without bond.'
const LAYER: TextLayer = {
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'test',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: TEXT,
  blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
  spans: [],
}
vi.mock('@/lib/review/run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/review/run')>()),
  buildLayer: vi.fn(async () => LAYER),
}))

import { linkReviewUpload, safeFilename, storeReviewUpload, uploadLabel } from '@/lib/review/uploads'
import { queueStoredUploadReview } from '@/lib/review/uploadReview'
import fs from 'node:fs'
import path from 'node:path'
import { saveFindings, saveTextLayer } from '@/lib/review/persist'
import { loadRunSummaries, loadRun, UNFILED_UPLOAD_TITLE } from '@/lib/review/history'
import { loadRunContext } from '@/lib/runs/context'
import { POST } from '@/app/api/staff/review/route'

const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<WorkbenchDatabase>

const PROMPT_SEED = {
  prompts: [{ id: 'p1', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' }],
  prompt_publications: [{ prompt_id: 'p1', version_id: 'v1' }],
  prompt_versions: [
    {
      id: 'v1',
      prompt_id: 'p1',
      version_number: 1,
      body: { kind: 'review', inputs: [], rules: [{ number: '1', risk: 'medium', statement: 'Bond is waived.' }] },
    },
  ],
}

beforeEach(() => {
  fake.written = []
  fake.removed = []
})

describe('uploadLabel and safeFilename', () => {
  it('uses the attorney’s name when given, else the filename without its extension', () => {
    expect(uploadLabel('  Smith —  prior will ', 'x.docx')).toBe('Smith — prior will')
    expect(uploadLabel('', 'Jones Trust 2019.pdf')).toBe('Jones Trust 2019')
  })

  it('keeps a key free of paths and odd characters', () => {
    expect(safeFilename('../../Smith Will (final).docx')).toBe('.._.._Smith_Will_final_.docx')
    expect(safeFilename('???')).toBe('document')
  })
})

describe('storeReviewUpload', () => {
  const input = { bytes: Buffer.from('bytes'), filename: 'Prior Will.docx', kind: 'docx' as const, label: '', userId: 'u1' }

  it('stores the bytes under their own prefix and records the upload', async () => {
    const client = makeFakeClient()
    const storage = { write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
    const result = await storeReviewUpload(asClient(client), input, storage)
    expect(result.ok).toBe(true)
    const [row] = client.tableRows('review_uploads')
    expect(row).toMatchObject({ label: 'Prior Will', filename: 'Prior Will.docx', file_kind: 'docx', size_bytes: 5 })
    expect(String(row.r2_key)).toMatch(/^review-uploads\/[0-9a-f-]{36}\/Prior_Will\.docx$/)
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('removes the stored bytes when the row cannot be recorded', async () => {
    const client = makeFakeClient()
    client.failTable('review_uploads', 'relation "review_uploads" does not exist')
    const storage = { write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
    const result = await storeReviewUpload(asClient(client), input, storage)
    expect(result).toMatchObject({ ok: false })
    expect(storage.remove).toHaveBeenCalledTimes(1)
  })
})

describe('persisting a review of an upload', () => {
  it('anchors the text layer and citations to the upload, never to a version', async () => {
    const client = makeFakeClient()
    const layer = await saveTextLayer(asClient(client), { reviewUploadId: 'up1', layer: LAYER })
    expect(layer.ok).toBe(true)
    expect(client.tableRows('document_text_layers')[0]).toMatchObject({ review_upload_id: 'up1', document_version_id: null })

    await saveFindings(asClient(client), {
      reviewUploadId: 'up1',
      runId: 'run-1',
      textLayerId: 'layer-1',
      result: {
        playbookSlug: 's',
        playbookVersion: 1,
        failures: [],
        findings: [
          {
            ruleNumber: '1',
            outcome: 'deviation',
            severity: 'medium',
            rationale: 'r',
            proposedLanguage: null,
            citation: { blockIndex: 0, charStart: 0, charEnd: 5, page: null, bbox: null, quote: 'The T', verification: 'verified' },
            citationRefusal: null,
            attemptedQuote: null,
          },
        ],
      },
    })
    expect(client.tableRows('workflow_citations')[0]).toMatchObject({ review_upload_id: 'up1', document_version_id: null })
  })
})

describe('reading back a review of an upload', () => {
  const seed = () =>
    makeFakeClient({
      ...PROMPT_SEED,
      review_uploads: [{ id: 'up1', label: 'Smith — prior will', filename: 'smith.docx' }],
      workflow_runs: [
        {
          id: 'run-up',
          kind: 'review',
          matter_id: null,
          document_version_id: null,
          review_upload_id: 'up1',
          text_layer_id: 'layer-1',
          prompt_version_id: 'v1',
          status: 'completed',
          rule_total: 1,
          finding_count: 0,
          failed_count: 0,
          failures: [],
          started_at: '2026-09-25T20:00:00Z',
          finished_at: '2026-09-25T20:01:00Z',
          model: null,
          render_version: 1,
          resolved_inputs: null,
        },
      ],
      document_text_layers: [
        {
          id: 'layer-1',
          review_upload_id: 'up1',
          document_version_id: null,
          source_kind: 'docx',
          status: 'ok',
          extractor: 'test',
          extractor_version: '1',
          source_sha256: 'a'.repeat(64),
          page_count: null,
          text: TEXT,
          blocks: LAYER.blocks,
          spans: [],
        },
      ],
    })

  it('lists it by its label, as not filed on a matter', async () => {
    const [summary] = await loadRunSummaries(asClient(seed()))
    expect(summary).toMatchObject({ documentName: 'Smith — prior will', matterTitle: UNFILED_UPLOAD_TITLE, unfiled: true })
  })

  it('loads it with no matter rather than a matter named "null"', async () => {
    const run = await loadRun(asClient(seed()), 'run-up')
    expect(run).toMatchObject({ matterId: null, reviewUploadId: 'up1', documentLabel: 'Smith — prior will', documentVersionId: null })
  })

  it('gives the tick a context it can work', async () => {
    const context = await loadRunContext(asClient(seed()), 'run-up')
    expect(context.ok && context.kind === 'review' && context.run.review_upload_id).toBe('up1')
  })
})

describe('POST /api/staff/review with an upload', () => {
  const upload = (label?: string) => {
    const form = new FormData()
    form.set('document', new File([Buffer.from('docx bytes')], 'Prior Will.docx'))
    if (label) form.set('label', label)
    return new Request('http://localhost/api/staff/review', { method: 'POST', body: form })
  }

  it('keeps the upload and queues a recorded run with no matter', async () => {
    const client = makeFakeClient(PROMPT_SEED)
    fake.client = client
    const response = await POST(upload('Smith — prior will'))
    const body = await response.json()

    expect(body).toMatchObject({ queued: true, anchor: null, saveError: null })
    expect(fake.written).toHaveLength(1)
    const [run] = client.tableRows('workflow_runs')
    expect(run).toMatchObject({ matter_id: null, document_version_id: null, review_upload_id: body.reviewUploadId, kind: 'review' })
    expect(client.tableRows('review_uploads')[0]).toMatchObject({ label: 'Smith — prior will' })
    expect(client.tableRows('workflow_run_steps').map((s) => s.unit_id)).toEqual(['1'])
  })

  it('falls back to an unrecorded review, saying why, when the upload cannot be kept', async () => {
    const client = makeFakeClient(PROMPT_SEED)
    client.failTable('review_uploads', 'relation "review_uploads" does not exist')
    fake.client = client
    const body = await (await POST(upload())).json()
    expect(body.runId).toBeNull()
    expect(body.saveError).toMatch(/review_uploads/)
    expect(body.result).toBeDefined()
    expect(fake.removed).toHaveLength(1)
  })
})


describe('linking an upload to a matter later', () => {
  const seed = (extra: Record<string, Array<Record<string, unknown>>> = {}) =>
    makeFakeClient({
      ...PROMPT_SEED,
      matters: [{ id: 'm1', name: 'Smith Estate Plan' }],
      review_uploads: [{ id: 'up1', label: 'Smith — prior will', filename: 'smith.docx', file_kind: 'docx', r2_key: 'k', matter_id: null, linked_at: null }],
      document_text_layers: [
        {
          id: 'layer-1',
          review_upload_id: 'up1',
          document_version_id: null,
          source_kind: 'docx',
          status: 'ok',
          extractor: 'test',
          extractor_version: '1',
          source_sha256: 'a'.repeat(64),
          page_count: null,
          text: TEXT,
          blocks: LAYER.blocks,
          spans: [],
        },
      ],
      ...extra,
    })

  it('links with a stamp, and unlinks clearing it', async () => {
    const client = seed()
    expect(await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: 'm1', userId: 'u1' })).toEqual({ ok: true })
    expect(client.tableRows('review_uploads')[0]).toMatchObject({ matter_id: 'm1', linked_by: 'u1' })
    expect(client.tableRows('review_uploads')[0].linked_at).toEqual(expect.any(String))

    await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: null, userId: 'u1' })
    expect(client.tableRows('review_uploads')[0]).toMatchObject({ matter_id: null, linked_at: null, linked_by: null })
  })

  it('refuses a matter or an upload that does not exist', async () => {
    const client = seed()
    expect((await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: 'nope', userId: 'u1' })).ok).toBe(false)
    expect((await linkReviewUpload(asClient(client), { reviewUploadId: 'missing', matterId: 'm1', userId: 'u1' })).ok).toBe(false)
    expect(client.tableRows('review_uploads')[0].matter_id).toBeNull()
  })

  it('reviews a linked upload again from its stored layer, with the matter’s facts pinned and no matter on the run', async () => {
    const client = seed({
      design_sheets: [{ matter_id: 'm1', version: 1, marital_status: 'married', is_joint: false, children: [], plan_type: null, assets: [] }],
    })
    await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: 'm1', userId: 'u1' })
    const result = await queueStoredUploadReview(asClient(client), {
      reviewUploadId: 'up1',
      promptVersionId: 'v1',
      ruleNumbers: ['1'],
      userId: 'u1',
    })
    expect(result).toMatchObject({ ok: true, matterFactsApplied: true })
    const [run] = client.tableRows('workflow_runs')
    expect(run).toMatchObject({ matter_id: null, review_upload_id: 'up1', text_layer_id: 'layer-1', kind: 'review' })
    expect((run.resolved_inputs as { matterFacts: { married: boolean } }).matterFacts.married).toBe(true)
    expect(client.tableRows('workflow_run_steps').map((s) => s.unit_id)).toEqual(['1'])
  })

  it('reviews an unlinked upload again with every rule, and refuses one with no stored text', async () => {
    const client = seed()
    const result = await queueStoredUploadReview(asClient(client), { reviewUploadId: 'up1', promptVersionId: 'v1', ruleNumbers: ['1'], userId: 'u1' })
    expect(result).toMatchObject({ ok: true, matterFactsApplied: false })
    expect(client.tableRows('workflow_runs')[0].resolved_inputs).toBeNull()

    const empty = seed({ document_text_layers: [] })
    expect(await queueStoredUploadReview(asClient(empty), { reviewUploadId: 'up1', promptVersionId: 'v1', ruleNumbers: ['1'], userId: 'u1' })).toMatchObject({ ok: false, status: 409 })
  })

  it('reviews a Word snapshot again from the paragraph text its citations index', async () => {
    const client = seed()
    client.tableRows('review_uploads')[0].origin = 'word'
    client.tableRows('document_text_layers')[0].source_kind = 'plain'
    const result = await queueStoredUploadReview(asClient(client), { reviewUploadId: 'up1', promptVersionId: 'v1', ruleNumbers: ['1'], userId: 'u1' })
    expect(result).toMatchObject({ ok: true })
    expect(client.tableRows('workflow_runs')[0]).toMatchObject({ review_upload_id: 'up1', text_layer_id: 'layer-1' })
  })

  it('labels a Word snapshot’s reviews as from Word, under its matter or on their own', async () => {
    const run = { id: 'run-w', kind: 'review', matter_id: null, document_version_id: null, review_upload_id: 'up1', text_layer_id: 'layer-1', prompt_version_id: 'v1', status: 'completed', rule_total: 1, finding_count: 0, failed_count: 0, failures: [], started_at: '2026-09-26T10:00:00Z', finished_at: null }
    const client = seed({ workflow_runs: [run] })
    client.tableRows('review_uploads')[0].origin = 'word'
    expect((await loadRunSummaries(asClient(client)))[0].matterTitle).toBe(`${UNFILED_UPLOAD_TITLE} · from Word`)
    await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: 'm1', userId: 'u1' })
    expect((await loadRunSummaries(asClient(client)))[0].matterTitle).toBe('Smith Estate Plan · from Word')
    expect(await loadRun(asClient(client), 'run-w')).toMatchObject({ uploadFromWord: true })
  })

  it('queues it through the route by upload id', async () => {
    const client = seed()
    fake.client = client
    const form = new FormData()
    form.set('reviewUploadId', 'up1')
    const response = await POST(new Request('http://localhost/api/staff/review', { method: 'POST', body: form }))
    expect(await response.json()).toMatchObject({ queued: true, reviewUploadId: 'up1', matterFactsApplied: false })
    expect(fake.written).toHaveLength(0)
  })

  it('lists a linked upload’s reviews under its matter, marked as an upload', async () => {
    const client = seed({
      workflow_runs: [
        { id: 'run-up', kind: 'review', matter_id: null, document_version_id: null, review_upload_id: 'up1', text_layer_id: 'layer-1', prompt_version_id: 'v1', status: 'completed', rule_total: 1, finding_count: 0, failed_count: 0, failures: [], started_at: '2026-09-25T20:00:00Z', finished_at: null },
      ],
    })
    await linkReviewUpload(asClient(client), { reviewUploadId: 'up1', matterId: 'm1', userId: 'u1' })
    const [summary] = await loadRunSummaries(asClient(client))
    expect(summary.matterTitle).toBe('Smith Estate Plan · upload')
    const run = await loadRun(asClient(client), 'run-up')
    expect(run).toMatchObject({ matterId: null, uploadMatterId: 'm1', uploadMatterTitle: 'Smith Estate Plan', uploadFiled: false })

    client.tableRows('review_uploads')[0].filed_document_id = 'doc-1'
    expect(await loadRun(asClient(client), 'run-up')).toMatchObject({ uploadFiled: true })
  })

  it('keeps the link stamp honest in the database, including when the matter is deleted', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261228090000_review_upload_matter_link.sql'),
      'utf8',
    )
    expect(sql).toMatch(/references public\.matters\(id\) on delete set null/)
    expect(sql).toMatch(/check \(\(matter_id is null\) = \(linked_at is null\)\)/)
    expect(sql).toMatch(/before update of matter_id on public\.review_uploads/)
  })
})
