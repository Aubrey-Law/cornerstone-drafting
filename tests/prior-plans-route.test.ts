import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBearerUser: vi.fn(),
  isAdminUser: vi.fn(),
  userCanAccessMatter: vi.fn(),
  filePriorPlan: vi.fn(),
  listPriorPlans: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ getBearerUser: mocks.getBearerUser }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({}) }))
vi.mock('@/lib/documentSecurity', () => ({
  isAdminUser: mocks.isAdminUser,
  userCanAccessMatter: mocks.userCanAccessMatter,
}))
vi.mock('@/lib/documents/priorPlans', () => ({
  filePriorPlan: mocks.filePriorPlan,
  listPriorPlans: mocks.listPriorPlans,
}))

import { GET, POST } from '@/app/api/documents/prior-plans/route'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function post(body: unknown) {
  return new Request('http://localhost/api/documents/prior-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBearerUser.mockResolvedValue({ id: 'staff-1' })
  mocks.isAdminUser.mockResolvedValue(true)
  mocks.userCanAccessMatter.mockResolvedValue(true)
  mocks.listPriorPlans.mockResolvedValue([])
})

describe('/api/documents/prior-plans', () => {
  it('is staff only: a client is refused and nothing is filed', async () => {
    mocks.isAdminUser.mockResolvedValue(false)
    const response = await POST(post({ matterId: MATTER, reviewUploadId: 'u1' }))
    expect(response.status).toBe(403)
    expect(mocks.filePriorPlan).not.toHaveBeenCalled()

    const list = await GET(new Request(`http://localhost/api/documents/prior-plans?matterId=${MATTER}`))
    expect(list.status).toBe(403)
    expect(mocks.listPriorPlans).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller and a missing matter', async () => {
    mocks.getBearerUser.mockResolvedValueOnce(null)
    expect((await POST(post({ matterId: MATTER, reviewUploadId: 'u1' }))).status).toBe(401)
    expect((await POST(post({ reviewUploadId: 'u1' }))).status).toBe(400)
    expect((await POST(post({ matterId: MATTER }))).status).toBe(400)
  })

  it('files as the signed-in attorney and passes the outcome through', async () => {
    mocks.filePriorPlan.mockResolvedValue({ ok: true, document: { id: 'doc-1' }, alreadyFiled: false })
    const response = await POST(post({ matterId: MATTER, reviewUploadId: 'u1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ document: { id: 'doc-1' }, alreadyFiled: false })
    expect(mocks.filePriorPlan).toHaveBeenCalledWith({}, { matterId: MATTER, reviewUploadId: 'u1', userId: 'staff-1' })

    mocks.filePriorPlan.mockResolvedValue({ ok: false, status: 409, code: 'not_linked', message: 'not linked' })
    const refused = await POST(post({ matterId: MATTER, reviewUploadId: 'u1' }))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'not linked', code: 'not_linked' })
  })
})
