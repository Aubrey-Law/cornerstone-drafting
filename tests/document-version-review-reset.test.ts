import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ update: vi.fn(), put: vi.fn() }))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: mocks.put, safeUploadFilename: (name: string) => name }))
import { createDocumentVersion } from '@/lib/documentVersions'
import type { SupabaseClient } from '@supabase/supabase-js'
beforeEach(() => vi.clearAllMocks())
it('clears the previous review in the same write that makes edited bytes current', async () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'insert']) chain[method] = () => chain
  chain.update = (values: unknown) => { mocks.update(values); return chain }
  chain.maybeSingle = async () => ({ data: { version_number: 1 }, error: null })
  chain.single = async () => ({ data: { id: 'v2', version_number: 2 }, error: null })
  const result = await createDocumentVersion({ admin: { from: () => chain } as unknown as SupabaseClient, documentId: 'doc', matterId: 'matter', bytes: Buffer.from('new'), filename: 'Trust.docx', contentType: 'docx', source: 'user_accept', createdBy: 'u' })
  expect(result).toEqual({ version: { id: 'v2', version_number: 2 } })
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ current_version_id: 'v2', reviewed_at: null, reviewed_by: null, r2_key: expect.any(String) }))
})
