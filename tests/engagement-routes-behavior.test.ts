import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const scoped = vi.fn()
const approve = vi.fn()
const send = vi.fn()
vi.mock('@/lib/engagement/http', () => ({
  requireEngagementStaff: requireStaff,
  getScopedAgreement: scoped,
  engagementHttpError: (e: unknown) => Response.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 400 }),
}))
vi.mock('@/lib/engagement/runtime', () => ({ engagementService: () => ({ approveAgreementRevision: approve, sendApprovedAgreement: send }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/components/engagement/EngagementWorkspace', () => ({ default: () => null }))

describe('engagement approval and send routes', () => {
  beforeEach(() => { vi.clearAllMocks(); requireStaff.mockResolvedValue({ id: 'staff-1' }); scoped.mockResolvedValue({ id: 'a1' }) })

  it('binds approval to the exact reviewed revision and PDF hash', async () => {
    approve.mockResolvedValue('token')
    const { POST } = await import('@/app/api/admin/engagement-agreements/[id]/approve/route')
    const response = await POST(new Request('http://test', { method:'POST', body:JSON.stringify({ revisionId:'r1', pdfSha256:'hash-1' }) }), { params:Promise.resolve({ id:'a1' }) })
    expect(response.status).toBe(200)
    expect(approve).toHaveBeenCalledWith({ agreementId:'a1', revisionId:'r1', renderSha256:'hash-1' })
  })

  it('rejects before scoped data access when staff authorization fails', async () => {
    requireStaff.mockRejectedValue(new Error('Forbidden'))
    const { POST } = await import('@/app/api/admin/engagement-agreements/[id]/approve/route')
    await POST(new Request('http://test', { method:'POST', body:'{}' }), { params:Promise.resolve({ id:'a1' }) })
    expect(scoped).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  it('passes explicit reviewed identity through send and requires confirmation', async () => {
    send.mockResolvedValue({ requestId:'firma-1' })
    const { POST } = await import('@/app/api/admin/engagement-agreements/[id]/send/route')
    const body={ approvalToken:'token', confirmExactRevision:true, revisionId:'r1', pdfSha256:'hash-1' }
    await POST(new Request('http://test',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'a1'})})
    expect(send).toHaveBeenCalledWith({ agreementId:'a1', approvalToken:'token', sentBy:'staff-1', revisionId:'r1', renderSha256:'hash-1' })
    send.mockClear()
    await POST(new Request('http://test',{method:'POST',body:JSON.stringify({...body,confirmExactRevision:false})}),{params:Promise.resolve({id:'a1'})})
    expect(send).not.toHaveBeenCalled()
  })

  it('page loader independently authorizes before its service-role scoped read', async () => {
    requireStaff.mockRejectedValue(new Error('Forbidden'))
    const { default: Page } = await import('@/app/admin/engagements/[agreementId]/page')
    await expect(Page({ params:Promise.resolve({ agreementId:'a1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(scoped).not.toHaveBeenCalled()
  })
})
