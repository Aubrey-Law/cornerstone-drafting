import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const requireAdmin = vi.hoisted(() => vi.fn())
const deleteIn = vi.hoisted(() => vi.fn())
const revalidateSidebarCounts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({ delete: () => ({ in: deleteIn }) }) }),
}))

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

type RouteRequest = Parameters<
  typeof import('@/app/api/admin/calls/bulk-delete/route').POST
>[0]

function request(body: unknown) {
  return new Request('http://test/api/admin/calls/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as RouteRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
  deleteIn.mockResolvedValue({ error: null })
})

describe('POST /api/admin/calls/bulk-delete', () => {
  it('deletes every selected call in one query', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A, ID_B] }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deleted: 2 })
    expect(deleteIn).toHaveBeenCalledWith('id', [ID_A, ID_B])
    expect(revalidateSidebarCounts).toHaveBeenCalled()
  })

  it('refuses a non-admin', async () => {
    requireAdmin.mockResolvedValue({
      err: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A] }))

    expect(response.status).toBe(401)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects an empty selection', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [] }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects ids that are not call ids', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A, 'id.eq.anything'] }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('rejects more than 200 ids', async () => {
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: Array.from({ length: 201 }, () => ID_A) }))

    expect(response.status).toBe(400)
    expect(deleteIn).not.toHaveBeenCalled()
  })

  it('surfaces a database failure', async () => {
    deleteIn.mockResolvedValue({ error: { message: 'permission denied' } })
    const { POST } = await import('@/app/api/admin/calls/bulk-delete/route')
    const response = await POST(request({ ids: [ID_A] }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'permission denied' })
  })
})
