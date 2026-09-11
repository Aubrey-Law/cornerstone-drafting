import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), canRead: vi.fn(), admin: vi.fn(), loadVersion: vi.fn(), loadBytes: vi.fn() }))
vi.mock('@/lib/documentSecurity', () => ({ userCanReadDocument: mocks.canRead, isAdminUser: mocks.admin }))
vi.mock('@/lib/documentApiHelpers', () => ({ getDocumentApiUser: mocks.user, isDocxDocument: () => true, loadR2Bytes: mocks.loadBytes, DOCX_CONTENT_TYPE: 'docx' }))
vi.mock('@/lib/documentVersions', () => ({ loadActiveVersion: mocks.loadVersion }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: () => { const chain: Record<string, unknown> = {}; for (const key of ['select', 'eq']) chain[key] = () => chain; chain.single = async () => ({ data: { id: 'doc', name: 'Trust.docx', r2_key: 'current', current_version_id: 'v2' }, error: null }); return chain } }) }))
import { GET } from '@/app/api/documents/[id]/docx/route'
import { documentReviewRevision } from '@/lib/documents/reviewRevision'
const request = () => new Request('http://localhost/api/documents/doc/docx?version_id=v1')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'u' }); mocks.canRead.mockResolvedValue(true); mocks.admin.mockResolvedValue(true)
  mocks.loadVersion.mockResolvedValue({ id: 'v1', r2_key: 'previous' }); mocks.loadBytes.mockResolvedValue(Buffer.from('historical bytes'))
})
it('serves the requested historical bytes with their revision, using authenticated access', async () => {
  const response = await GET(request(), { params: Promise.resolve({ id: 'doc' }) })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('historical bytes')
  expect(response.headers.get('X-Document-Revision')).toBe(documentReviewRevision({ r2_key: 'previous', current_version_id: 'v1' }))
  expect(mocks.loadVersion).toHaveBeenCalledWith(expect.anything(), 'doc', 'v1')
})
it('does not fall back to current bytes for a missing or unrelated historical version', async () => {
  mocks.loadVersion.mockResolvedValue(null)
  const response = await GET(request(), { params: Promise.resolve({ id: 'doc' }) })
  expect(response.status).toBe(404)
  expect(mocks.loadBytes).not.toHaveBeenCalled()
})
it('does not let portal access to a shared current document expose historical versions', async () => {
  mocks.admin.mockResolvedValue(false)
  const response = await GET(request(), { params: Promise.resolve({ id: 'doc' }) })
  expect(response.status).toBe(403)
  expect(mocks.loadBytes).not.toHaveBeenCalled()
})
