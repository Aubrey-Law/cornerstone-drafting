import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), update: vi.fn(), scan: vi.fn(), loadR2Bytes: vi.fn(), convert: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/documentSecurity', () => ({ isAdminUser: vi.fn(async () => true), auditDocumentAccess: vi.fn() }))
vi.mock('@/lib/documentApiHelpers', () => ({ getDocumentApiUser: vi.fn(async () => ({ id: 'u' })), isDocxDocument: () => true, loadR2Bytes: mocks.loadR2Bytes, DOCX_CONTENT_TYPE: 'docx', PDF_CONTENT_TYPE: 'application/pdf' }))
vi.mock('@/lib/docxPdfConvert', () => ({ convertDocxToPdf: mocks.convert, isDocxPdfConvertConfigured: () => true, DocxPdfConvertError: class extends Error {}, DocxPdfConvertNotConfiguredError: class extends Error {} }))
vi.mock('@/lib/documentVersions', () => ({ ensureInitialVersion: vi.fn(), loadActiveVersion: vi.fn(async () => ({ id: 'v1', r2_key: 'active' })), createDocumentVersion: vi.fn(async () => null) }))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(), safeUploadFilename: (name: string) => name }))
vi.mock('@/lib/drafting/markerScan', () => ({ scanDocxBufferForMarkers: mocks.scan }))
import { POST } from '@/app/api/documents/[id]/convert-pdf/route'
const document = { id: 'doc', name: 'Trust.docx', matter_id: 'matter', r2_key: 'active', current_version_id: 'v1', missing_count: 0, marker_count: 0, reviewed_at: 'old', generation_id: 'g' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadR2Bytes.mockResolvedValue(Buffer.from('docx'))
  mocks.convert.mockResolvedValue(Buffer.from('pdf'))
  mocks.scan.mockReturnValue({ markerCount: 2, missingFields: ['client.name'], todoCount: 1, unresolved: [] })
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is']) chain[name] = () => chain
  chain.insert = (data: unknown) => { mocks.insert(data); return chain }
  chain.update = (data: unknown) => { mocks.update(data); return chain }
  chain.single = async () => ({ data: document, error: null })
  chain.maybeSingle = async () => ({ data: document, error: null })
  mocks.from.mockReturnValue(chain)
})
describe('conversion is separate from review', () => {
  it('creates an unreviewed, unshared PDF and scans the exact source bytes for missing fields', async () => {
    const response = await POST(new Request('http://localhost/api/documents/doc/convert-pdf', { method: 'POST' }), { params: Promise.resolve({ id: 'doc' }) })
    expect(response.status).toBe(200)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ shared_at: null, reviewed_at: null, reviewed_by: null, missing_count: 1, marker_count: 2, generation_id: 'g' }))
    expect(mocks.scan).toHaveBeenCalledWith(Buffer.from('docx'))
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ reviewed_at: expect.any(String) }))
  })
})
