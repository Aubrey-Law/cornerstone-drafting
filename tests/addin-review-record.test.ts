import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const r2 = vi.hoisted(() => ({ written: [] as Array<[string, string]>, removed: [] as string[] }))
vi.mock('@/lib/documentUpload', () => ({
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  putFileToR2: vi.fn(async (key: string, _bytes: Buffer, contentType: string) => {
    r2.written.push([key, contentType])
  }),
}))
vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: vi.fn(async (key: string) => { r2.removed.push(key) }) }))

// The route's own dependencies, for the end-to-end case at the bottom.
const db = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => db.current) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1' } })),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 12, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn(async () => 'claude-test') }))
vi.mock('@/lib/anthropic', () => ({
  callAnthropic: vi.fn(async () => ({
    content: [
      {
        type: 'tool_use',
        name: 'report_finding',
        id: 'x',
        input: {
          outcome: 'deviation',
          rationale: 'The waiver runs to anyone who serves.',
          quote: 'The Trustee shall serve without bond.',
          block_index: 2,
          proposed_language: 'Any Trustee named herein shall serve without bond.',
        },
      },
    ],
  })),
}))
const playbooks = vi.hoisted(() => ({ playbook: null as unknown }))
vi.mock('@/lib/addinReview/playbooks', () => ({
  loadReviewPlaybook: vi.fn(async () => playbooks.playbook),
  loadMatterFacts: vi.fn(async () => null),
}))

import { snapshotLabel, startReviewRecording } from '@/lib/addinReview/record'
import { POST } from '@/app/api/addin/review/route'
import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import { deriveMatterFacts } from '@aubrey-law/citations/review/conditions'
import type { ReviewFinding, ReviewRule } from '@aubrey-law/citations/review/types'
import { applyReviewEvent, EMPTY_REVIEW, parseReviewFrame } from '../word-addin/src/taskpane/review/model'

type Row = Record<string, unknown>

/** supabase-js, as far as the recorder uses it: insert/select/single, upsert, update/eq. */
function fakeAdmin(options: { failInsertInto?: string } = {}) {
  const tables: Record<string, Row[]> = {}
  let nextId = 1

  function from(table: string) {
    let mode: 'insert' | 'update' | 'upsert' | 'select' = 'select'
    let payload: Row = {}
    let conflict: string[] = []
    const filters: Array<[string, unknown]> = []
    const rows = () => (tables[table] ??= [])

    const run = () => {
      if (options.failInsertInto === table && (mode === 'insert' || mode === 'upsert')) {
        return { data: null, error: { message: `${table} is unavailable` } }
      }
      if (mode === 'insert') {
        const row = { id: `${table}-${nextId++}`, ...payload }
        rows().push(row)
        return { data: row, error: null }
      }
      if (mode === 'upsert') {
        const existing = rows().find(row => conflict.every(column => row[column] === payload[column]))
        if (existing) Object.assign(existing, payload)
        else rows().push({ id: `${table}-${nextId++}`, ...payload })
        return { data: null, error: null }
      }
      if (mode === 'update') {
        for (const row of rows()) if (filters.every(([column, value]) => row[column] === value)) Object.assign(row, payload)
        return { data: null, error: null }
      }
      return { data: rows().filter(row => filters.every(([column, value]) => row[column] === value)), error: null }
    }

    const builder = {
      insert: (values: Row) => { mode = 'insert'; payload = values; return builder },
      update: (values: Row) => { mode = 'update'; payload = values; return builder },
      upsert: (values: Row, opts: { onConflict: string }) => {
        mode = 'upsert'
        payload = values
        conflict = opts.onConflict.split(',')
        return builder
      },
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return builder },
      single: async () => run(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    }
    return builder
  }

  return { client: { from } as never, tables }
}

const PARAGRAPHS = ['REVOCABLE TRUST', '', 'The Trustee shall serve without bond.', 'The Trustee may appoint a guardian.']
const LAYER = buildPlainTextLayer(PARAGRAPHS)
const RULES: ReviewRule[] = [
  { number: '1', risk: 'medium', statement: 'Bond is waived only for named trustees.', preferredLanguage: 'named herein' },
  { number: '2', risk: 'high', statement: 'Guardians are named.' },
]
/** The shortest thing that passes for a .docx: a zip's magic bytes. */
const DOCX_BASE64 = Buffer.from('PK\u0003\u0004 a docx').toString('base64')

const VERIFIED: ReviewFinding = {
  ruleNumber: '1',
  outcome: 'deviation',
  severity: 'medium',
  rationale: 'The waiver runs to anyone who serves.',
  proposedLanguage: 'Any Trustee named herein shall serve without bond.',
  citation: {
    blockIndex: 2,
    charStart: 19,
    charEnd: 56,
    page: null,
    bbox: null,
    quote: 'The Trustee shall serve without bond.',
    verification: 'verified',
  } as ReviewFinding['citation'],
  citationRefusal: null,
  attemptedQuote: null,
}

function input(overrides: Partial<Parameters<typeof startReviewRecording>[1]> = {}) {
  return {
    fileBase64: DOCX_BASE64,
    documentName: 'Smith Trust draft',
    layer: LAYER,
    playbook: { versionId: 'v2', rules: RULES },
    model: 'claude-test',
    matterId: 'm1',
    matterFacts: deriveMatterFacts({ children: [{ name: 'A', is_minor: true }] }),
    sourceDocumentId: 'doc-1',
    userId: 'user-1',
    ...overrides,
  }
}

beforeEach(() => {
  r2.written = []
  r2.removed = []
})

describe('startReviewRecording', () => {
  it('keeps a snapshot linked to the matter, its paragraph text, a running run and a pending step per rule', async () => {
    const admin = fakeAdmin()
    const started = await startReviewRecording(admin.client, input())
    expect(started.ok).toBe(true)

    expect(r2.written).toHaveLength(1)
    expect(r2.written[0][0]).toMatch(/^review-uploads\/[0-9a-f-]+\/Smith_Trust_draft\.docx$/)

    const [upload] = admin.tables.review_uploads
    expect(upload).toMatchObject({
      label: 'Smith Trust draft',
      file_kind: 'docx',
      origin: 'word',
      matter_id: 'm1',
      linked_by: 'user-1',
      source_document_id: 'doc-1',
      created_by: 'user-1',
    })
    expect(upload.linked_at).toEqual(expect.any(String))

    const [layer] = admin.tables.document_text_layers
    expect(layer).toMatchObject({ review_upload_id: upload.id, document_version_id: null, source_kind: 'plain', text: LAYER.text })

    const [run] = admin.tables.workflow_runs
    expect(run).toMatchObject({
      // The matter lives on the snapshot, never the run.
      matter_id: null,
      review_upload_id: upload.id,
      text_layer_id: layer.id,
      prompt_version_id: 'v2',
      kind: 'review',
      status: 'running',
      rule_total: 2,
      resolved_inputs: { matterFacts: expect.objectContaining({ has_minor_children: true }) },
    })
    expect(run.last_tick_at).toEqual(expect.any(String))
    expect(admin.tables.workflow_run_steps.map(step => [step.unit_id, step.sequence, step.status])).toEqual([
      ['1', 0, 'pending'],
      ['2', 1, 'pending'],
    ])
  })

  it('records each rule as it settles, then the run’s status and counts', async () => {
    const admin = fakeAdmin()
    const started = await startReviewRecording(admin.client, input())
    if (!started.ok) throw new Error(started.reason)
    const { recorder } = started

    await recorder.recordRule(RULES[0], 0, { findings: [VERIFIED], failures: [] })
    await recorder.recordRule(RULES[1], 1, { findings: [], failures: [{ ruleNumber: '2', reason: 'overloaded' }] })
    await recorder.finish(false)
    expect(recorder.problem()).toBeNull()

    const [finding] = admin.tables.workflow_findings
    expect(finding).toMatchObject({ run_id: recorder.runId, rule_number: '1', outcome: 'deviation' })
    expect(admin.tables.workflow_citations).toEqual([
      expect.objectContaining({
        finding_id: finding.id,
        review_upload_id: recorder.reviewUploadId,
        document_version_id: null,
        block_index: 2,
        quote: 'The Trustee shall serve without bond.',
      }),
    ])
    expect(admin.tables.workflow_run_steps.map(step => [step.unit_id, step.status, step.finding_id ?? null, step.last_error])).toEqual([
      ['1', 'succeeded', finding.id, null],
      ['2', 'failed', null, 'overloaded'],
    ])
    expect(admin.tables.workflow_runs[0]).toMatchObject({
      status: 'partial',
      finding_count: 1,
      failed_count: 1,
      failures: [{ ruleNumber: '2', reason: 'overloaded' }],
    })
    expect(admin.tables.workflow_runs[0].finished_at).toEqual(expect.any(String))
  })

  it('stores no citation for a quote that did not verify', async () => {
    const admin = fakeAdmin()
    const started = await startReviewRecording(admin.client, input())
    if (!started.ok) throw new Error(started.reason)
    await started.recorder.recordRule(RULES[0], 0, {
      findings: [{ ...VERIFIED, citation: null, citationRefusal: 'not_found', attemptedQuote: 'bond waived' }],
      failures: [],
    })
    expect(admin.tables.workflow_findings).toHaveLength(1)
    expect(admin.tables.workflow_citations ?? []).toEqual([])
  })

  it('hands a stopped review to the queue, which finishes the rules still pending', async () => {
    const admin = fakeAdmin()
    const started = await startReviewRecording(admin.client, input())
    if (!started.ok) throw new Error(started.reason)
    await started.recorder.recordRule(RULES[0], 0, { findings: [VERIFIED], failures: [] })
    await started.recorder.finish(true)

    expect(admin.tables.workflow_runs[0]).toMatchObject({ status: 'queued', finished_at: null, last_tick_at: null })
    expect(admin.tables.workflow_run_steps.find(step => step.unit_id === '2')?.status).toBe('pending')
  })

  it('is not linked to a matter when the pane has none', async () => {
    const admin = fakeAdmin()
    await startReviewRecording(admin.client, input({ matterId: null, matterFacts: null, sourceDocumentId: null }))
    expect(admin.tables.review_uploads[0]).toMatchObject({ matter_id: null, linked_at: null, linked_by: null, source_document_id: null })
    expect(admin.tables.workflow_runs[0].resolved_inputs).toBeNull()
  })

  it('refuses bytes that are not a .docx, writing nothing', async () => {
    const admin = fakeAdmin()
    for (const fileBase64 of ['', Buffer.from('%PDF-1.7').toString('base64')]) {
      const started = await startReviewRecording(admin.client, input({ fileBase64 }))
      expect(started.ok).toBe(false)
    }
    expect(r2.written).toEqual([])
    expect(admin.tables.review_uploads).toBeUndefined()
  })

  it('removes the stored copy when the snapshot row cannot be written', async () => {
    const admin = fakeAdmin({ failInsertInto: 'review_uploads' })
    const started = await startReviewRecording(admin.client, input())
    expect(started).toMatchObject({ ok: false, reason: expect.stringContaining('review_uploads is unavailable') })
    expect(r2.removed).toEqual([r2.written[0][0]])
  })

  it('stops writing after a failed write, and leaves the run for the reaper to hand back', async () => {
    const admin = fakeAdmin({ failInsertInto: 'workflow_findings' })
    const started = await startReviewRecording(admin.client, input())
    if (!started.ok) throw new Error(started.reason)
    await started.recorder.recordRule(RULES[0], 0, { findings: [VERIFIED], failures: [] })
    await started.recorder.recordRule(RULES[1], 1, { findings: [], failures: [{ ruleNumber: '2', reason: 'x' }] })
    await started.recorder.finish(false)

    expect(started.recorder.problem()).toContain('Could not store a finding')
    // Still running with its steps pending: nothing claims it was finished.
    expect(admin.tables.workflow_runs[0].status).toBe('running')
    expect(admin.tables.workflow_run_steps.every(step => step.status === 'pending')).toBe(true)
  })
})

describe('snapshotLabel', () => {
  it('uses the document’s name, or a dated fallback for an unsaved one', () => {
    expect(snapshotLabel('Smith Trust draft.docx')).toBe('Smith Trust draft')
    expect(snapshotLabel(null, new Date('2026-09-26T12:00:00Z'))).toBe('Word document reviewed 2026-09-26')
  })
})

describe('POST /api/addin/review with the document', () => {
  beforeEach(() => {
    playbooks.playbook = { slug: 'ma-trust-firm-qa', title: 'Trust review', version: 2, versionId: 'v2', rules: RULES }
  })

  function request(body: unknown) {
    return new Request('http://localhost/api/addin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('records the review as it streams and tells the pane it was saved', async () => {
    const admin = fakeAdmin()
    db.current = admin.client
    const res = await POST(
      request({ paragraphs: PARAGRAPHS, playbookSlug: 'ma-trust-firm-qa', matterId: null, fileBase64: DOCX_BASE64, documentName: 'Draft' }),
    )
    const events = (await res.text()).split('\n\n').filter(Boolean).map(frame => parseReviewFrame(frame)!)

    const runId = String(admin.tables.workflow_runs[0].id)
    expect(events[0]).toMatchObject({ start: true, recording: { saved: true, runId } })
    expect(events.at(-1)).toMatchObject({ done: true, saved: true })
    expect(admin.tables.workflow_runs[0]).toMatchObject({ status: 'completed', finding_count: 2, failed_count: 0 })
    expect(admin.tables.workflow_findings).toHaveLength(2)

    const state = events.reduce(applyReviewEvent, EMPTY_REVIEW)
    expect(state.recording).toEqual({ saved: true, runId })
    expect(state.recordingProblem).toBeNull()
  })

  it('still reviews, unsaved, when the pane sends no document', async () => {
    const admin = fakeAdmin()
    db.current = admin.client
    const events = (await (await POST(request({ paragraphs: PARAGRAPHS, playbookSlug: 'ma-trust-firm-qa' }))).text())
      .split('\n\n')
      .filter(Boolean)
      .map(frame => parseReviewFrame(frame)!)
    expect(events[0]).toMatchObject({ recording: { saved: false } })
    expect(events.at(-1)).toMatchObject({ done: true, completed: 2, saved: false })
    expect(admin.tables.workflow_runs).toBeUndefined()
  })
})
