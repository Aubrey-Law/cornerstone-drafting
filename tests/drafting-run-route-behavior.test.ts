import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ source: vi.fn(), claim: vi.fn(), update: vi.fn(), latest: vi.fn(), generate: vi.fn(), register: vi.fn(), query: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: async () => ({ user: { id: 'actor' } }), getBearerToken: () => 'token' }))
vi.mock('@/lib/buildDraftPayload', () => ({ resolveMatterId: async () => 'matter' }))
vi.mock('@/lib/drafting/sourceSnapshot', () => ({ loadDraftSourceSnapshot: mocks.source }))
vi.mock('@/lib/drafting/runStore', () => ({ claimDraftRun: mocks.claim, updateDraftRun: mocks.update, latestDraftRun: mocks.latest, publicDraftRun: (r: unknown) => r }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.query }) }))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({}), r2Bucket: () => 'test' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://upload.test' }))
vi.mock('@/lib/estateGenerator/engine', () => ({ resolveEstateGeneratorEngine: () => 'node', llmDraftFallbackEnabled: () => false, llmFallbackEngineLabel: () => 'llm_fallback' }))
vi.mock('@/lib/estateGenerator/node/generate', () => ({ generateEstatePlanDocumentsNode: mocks.generate }))
vi.mock('@/lib/drafting/generateDocuments', () => ({ generateDocuments: vi.fn() }))
vi.mock('@/lib/estateGenerator/preflight', () => ({ buildEstateDraftPreflight: () => ({ documentsToGenerate: [] }) }))
vi.mock('@/lib/drafting/markerScan', () => ({ scanDocxBufferForMarkers: () => ({ markerCount: 0, todoCount: 0, unresolved: [], missingFields: [] }) }))
vi.mock('@/lib/realEstateTransfer/draftIntegration', () => ({ selectedRealEstateTransferDocTypes: () => [], generateAssetTransferFilesFromDesignSheet: vi.fn() }))
vi.mock('@/lib/estateClauses/persistGeneratedDocument', () => ({ persistGeneratedEstateDocument: vi.fn() }))
vi.mock('@/lib/drafting/persistGeneratedDocument', () => ({ registerDraftDocumentRow: mocks.register }))
import { POST } from '@/app/api/admin/matters/[id]/draft/route'
const run = { id: '20000000-0000-4000-8000-000000000001', matter_id: 'matter', source_revision: 'rev', request_hash: 'hash', requested_documents: ['trust.docx', 'will.docx'], status: 'running', outcomes: [], worker_token: 'token', created_at: '2026-09-11T12:00:00Z', lease_expires_at: '2099-01-01T00:00:00Z', updated_at: '', error: null }
const request = (revision = 'rev') => new NextRequest('http://localhost/api/admin/matters/matter/draft', { method: 'POST', body: JSON.stringify({ mode: 'save', runId: run.id, sourceRevision: revision, documents: run.requested_documents }) })
const files = [{ name: 'trust.docx', title: 'Trust', buffer: Buffer.from('a') }, { name: 'will.docx', title: 'Will', buffer: Buffer.from('b') }]
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) vi.stubEnv(key, 'test')
  mocks.source.mockResolvedValue({ payload: { design_sheet_id: 'sheet', client: { full_name: 'Example' }, documents: {}, matter: {} }, revision: 'rev', contacts: [] })
  mocks.claim.mockResolvedValue({ run: structuredClone(run), claimed: true }); mocks.update.mockResolvedValue(undefined)
  mocks.generate.mockResolvedValue({ ok: true, files }); mocks.register.mockResolvedValue({ data: { id: 'saved' } })
  mocks.query.mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'is', 'update', 'in']) chain[key] = () => chain
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  })
  mocks.upload.mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', mocks.upload)
})
it('rejects changed source before rendering or claiming a run', async () => {
  expect((await POST(request('old'), { params: Promise.resolve({ id: 'matter' }) })).status).toBe(409)
  expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled()
})
it('returns a partial result and keeps the successful document after a later upload fails', async () => {
  mocks.upload.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
  const result = await (await POST(request(), { params: Promise.resolve({ id: 'matter' }) })).json()
  expect(result.run.status).toBe('partial')
  expect(result.run.outcomes.map((o: { status: string }) => o.status)).toEqual(['saved', 'failed'])
  expect(mocks.register).toHaveBeenCalledTimes(1)
})
it('does not upload an already saved output after its document is renamed', async () => {
  mocks.claim.mockResolvedValue({ claimed: true, run: { ...run, outcomes: [{ filename: 'trust.docx', name: 'Renamed.docx', documentId: 'existing', status: 'saved' }] } })
  const result = await (await POST(request(), { params: Promise.resolve({ id: 'matter' }) })).json()
  expect(result.run.status).toBe('completed'); expect(mocks.upload).toHaveBeenCalledTimes(1)
  expect(result.documentRefs).toContainEqual({ id: 'existing', name: 'Renamed.docx' })
})
it('replays a completed run without rendering or uploading', async () => {
  mocks.claim.mockResolvedValue({ claimed: false, run: { ...run, status: 'completed', outcomes: [] } })
  const result = await POST(request(), { params: Promise.resolve({ id: 'matter' }) })
  expect(result.status).toBe(200); expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
})
it('reports selected output omitted by the renderer as failed', async () => {
  mocks.generate.mockResolvedValue({ ok: true, files: files.slice(0, 1) })
  const result = await (await POST(request(), { params: Promise.resolve({ id: 'matter' }) })).json()
  expect(result.run.status).toBe('partial')
  expect(result.run.outcomes[1]).toMatchObject({ filename: 'will.docx', status: 'failed' })
})
