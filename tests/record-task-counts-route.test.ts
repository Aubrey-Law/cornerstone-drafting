import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), counts: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/queries/tasks', () => ({ fetchRecordTaskCounts: mocks.counts, isUuid: (id: string) => /^[0-9a-f-]{36}$/.test(id) }))
import { GET } from '@/app/api/admin/tasks/counts/route'
const id = '11111111-2222-3333-4444-555555555555'
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'staff' }); mocks.counts.mockResolvedValue({ open: 603, overdue: 301 }) })
it('returns exact totals after firm authorization', async () => {
  const response = await GET(new Request(`http://localhost/api/admin/tasks/counts?recordId=${id}`))
  expect(await response.json()).toEqual({ counts: { open: 603, overdue: 301 } })
  expect(mocks.counts).toHaveBeenCalledWith(id)
})
it('denies client access before reading counts', async () => {
  mocks.auth.mockResolvedValue({ err: new Response(null, { status: 403 }) })
  expect((await GET(new Request(`http://localhost/?recordId=${id}`))).status).toBe(403)
  expect(mocks.counts).not.toHaveBeenCalled()
})
it.each(['', '?recordId=bad,id'])('rejects absent or malformed scope instead of counting the firm: %s', async query => {
  expect((await GET(new Request(`http://localhost/${query}`))).status).toBe(400)
  expect(mocks.counts).not.toHaveBeenCalled()
})
it('reports failed counts as unavailable', async () => {
  mocks.counts.mockRejectedValue(new Error('database detail'))
  const response = await GET(new Request(`http://localhost/?recordId=${id}`))
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'Task counts are unavailable. Please retry.' })
})
