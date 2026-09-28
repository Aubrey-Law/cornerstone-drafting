import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const r2 = vi.hoisted(() => ({ written: [] as string[] }))
vi.mock('@/lib/documentUpload', () => ({
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  putFileToR2: vi.fn(async (key: string) => {
    r2.written.push(key)
  }),
}))
vi.mock('@/lib/r2Delete', () => ({ deleteR2Key: vi.fn(async () => {}) }))

const db = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => db.current) }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1' })) }))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 20, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn(async () => 'claude-test') }))
vi.mock('@/lib/anthropic', () => ({
  callAnthropic: vi.fn(async () => ({
    content: [
      {
        type: 'tool_use',
        name: 'report_items',
        id: 'x',
        input: {
          items: [
            {
              category: 'Internal annotations',
              importance: 'important',
              title: 'TBD successor trustee',
              explanation: 'A placeholder is left in.',
              quote: '[TBD]',
              block_index: 1,
              replacement: 'Avideep Chawla',
            },
            {
              category: 'Spelling & grammar',
              importance: 'minor',
              title: 'Invented passage',
              explanation: 'Quotes something not there.',
              quote: 'not in this document',
              block_index: 0,
              replacement: 'x',
            },
          ],
        },
      },
    ],
  })),
}))

import { startScanRecording } from '@/lib/addinScan/record'
import { POST } from '@/app/api/addin/scan/route'
import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import { applyScanEvent, EMPTY_SCAN, type ScanEvent } from '../word-addin/src/taskpane/review/scan'
import { parseReviewFrame } from '../word-addin/src/taskpane/review/model'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

const PARAGRAPHS = ['REVOCABLE TRUST', 'The successor Trustee shall be [TBD].']
const LAYER = buildPlainTextLayer(PARAGRAPHS)
const DOCX_BASE64 = Buffer.from('PK\u0003\u0004 a docx').toString('base64')
const UPLOAD = '11111111-1111-4111-8111-111111111111'
const storage = { write: vi.fn(async () => {}), remove: vi.fn(async () => {}) }

const base = {
  kind: 'proofread' as const,
  layer: LAYER,
  model: 'claude-test',
  userId: 'user-1',
  reviewUploadId: null,
  fileBase64: null,
  documentName: 'Chawla plan.docx',
  matterId: null,
  sourceDocumentId: null,
}

/** A review's saved copy, as `storeSnapshot` leaves it. */
const reviewCopy = (text: string) =>
  makeFakeClient({
    review_uploads: [{ id: UPLOAD, label: 'Chawla plan', matter_id: null }],
    document_text_layers: [{ id: 'layer-1', review_upload_id: UPLOAD, source_kind: LAYER.sourceKind, text }],
  })

beforeEach(() => {
  r2.written = []
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('startScanRecording', () => {
  it('shares the review’s copy of the document when the text is the same', async () => {
    const admin = reviewCopy(LAYER.text)
    const started = await startScanRecording(admin as never, { ...base, reviewUploadId: UPLOAD, fileBase64: DOCX_BASE64 }, storage)
    expect(started.ok).toBe(true)
    expect(admin.tableRows('review_uploads')).toHaveLength(1)
    expect(storage.write).not.toHaveBeenCalled()
    expect(admin.tableRows('document_scans')[0]).toMatchObject({
      kind: 'proofread',
      review_upload_id: UPLOAD,
      text_layer_id: 'layer-1',
      status: 'running',
      created_by: 'user-1',
    })
  })

  it('keeps a copy of its own when the document changed after the review, rather than point at stale text', async () => {
    const admin = reviewCopy('an older draft')
    const started = await startScanRecording(admin as never, { ...base, reviewUploadId: UPLOAD, fileBase64: DOCX_BASE64 }, storage)
    expect(started.ok).toBe(true)
    expect(admin.tableRows('review_uploads')).toHaveLength(2)
    expect(admin.tableRows('document_scans')[0].review_upload_id).not.toBe(UPLOAD)
  })

  it('says why it is not saved when it has neither a matching copy nor the document', async () => {
    const admin = reviewCopy('an older draft')
    expect(await startScanRecording(admin as never, { ...base, reviewUploadId: UPLOAD }, storage)).toEqual({
      ok: false,
      reason: 'The document changed after the review saved its copy.',
    })
    expect(await startScanRecording(makeFakeClient() as never, base, storage)).toMatchObject({ ok: false })
  })

  it('stores a verified citation and its replacement, and only the attempt for one that was not found', async () => {
    const admin = makeFakeClient()
    const started = await startScanRecording(admin as never, { ...base, fileBase64: DOCX_BASE64 }, storage)
    if (!started.ok) throw new Error(started.reason)
    const verified = { blockIndex: 1, charStart: 47, charEnd: 52, page: null, bbox: null, quote: '[TBD]', verification: 'verified' as const }
    await started.recorder.recordItems([
      { id: 'a', category: 'Internal annotations', importance: 'important', title: 'TBD', explanation: 'x', replacement: 'Avideep', citation: verified, citationRefusal: null, attemptedQuote: null },
      { id: 'b', category: 'Other', importance: 'minor', title: 'Gone', explanation: 'y', replacement: null, citation: null, citationRefusal: 'not_found', attemptedQuote: 'nowhere' },
    ])
    await started.recorder.finish({ sections: 2, completed: 1, aborted: false, failures: [{ section: 2, reason: 'timeout' }] })

    const [first, second] = admin.tableRows('document_scan_items')
    expect(first).toMatchObject({ sequence: 0, item_key: 'a', block_index: 1, char_start: 47, char_end: 52, quote: '[TBD]', replacement: 'Avideep', citation_refusal: null })
    expect(second).toMatchObject({ sequence: 1, item_key: 'b', block_index: null, quote: null, replacement: null, citation_refusal: 'not_found', attempted_quote: 'nowhere' })
    expect(admin.tableRows('document_scans')[0]).toMatchObject({
      status: 'partial',
      section_total: 2,
      section_completed: 1,
      item_count: 2,
      failures: [{ section: 2, reason: 'timeout' }],
    })
    expect(started.recorder.problem()).toBeNull()
  })

  it('stops writing after a failed write and says so, without throwing', async () => {
    const admin = makeFakeClient()
    const started = await startScanRecording(admin as never, { ...base, fileBase64: DOCX_BASE64 }, storage)
    if (!started.ok) throw new Error(started.reason)
    admin.failTable('document_scan_items', 'disk full')
    await started.recorder.recordItems([
      { id: 'a', category: 'Other', importance: 'minor', title: 'T', explanation: '', replacement: null, citation: null, citationRefusal: null, attemptedQuote: null },
    ])
    expect(started.recorder.problem()).toMatch(/disk full/)
  })
})

describe('POST /api/addin/scan, saved', () => {
  const request = (body: unknown) =>
    new Request('http://localhost/api/addin/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('saves the check against the review’s copy and tells the pane where', async () => {
    const admin = reviewCopy(LAYER.text)
    db.current = admin
    const res = await POST(request({ kind: 'proofread', paragraphs: PARAGRAPHS, reviewUploadId: UPLOAD }))
    const events = (await res.text()).split('\n\n').filter(Boolean).map(f => parseReviewFrame(f) as unknown as ScanEvent)
    const state = events.reduce(applyScanEvent, EMPTY_SCAN)

    const scanId = String(admin.tableRows('document_scans')[0].id)
    expect(state.recording).toEqual({ saved: true, scanId, reviewUploadId: UPLOAD })
    expect(state.recordingProblem).toBeNull()
    expect(admin.tableRows('document_scans')[0]).toMatchObject({ status: 'completed', item_count: 2, section_completed: 1 })
    expect(admin.tableRows('document_scan_items').map(r => r.quote)).toEqual(['[TBD]', null])
  })

  it('still checks, unsaved, when the pane sends nothing to save against', async () => {
    db.current = makeFakeClient()
    const res = await POST(request({ kind: 'issues', paragraphs: PARAGRAPHS }))
    const state = (await res.text()).split('\n\n').filter(Boolean).map(f => parseReviewFrame(f) as unknown as ScanEvent).reduce(applyScanEvent, EMPTY_SCAN)
    expect(state.recording).toMatchObject({ saved: false })
    expect(state.items).toHaveLength(2)
  })
})
