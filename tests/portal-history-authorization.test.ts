import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({ getUser:vi.fn(),matter:vi.fn(),from:vi.fn(),read:vi.fn(),eq:vi.fn(),ids:vi.fn() }))
vi.mock('@/lib/supabaseServer',()=>({createServerSupabase:async()=>({auth:{getUser:mock.getUser}})}))
vi.mock('@/lib/portal/getMatterForUser',()=>({getMatterForUser:mock.matter}))
vi.mock('@/lib/supabaseAdmin',()=>({getAdminClient:()=>({from:mock.from}),ADMIN_EMAIL:'synthetic@example.invalid'}))
vi.mock('@/lib/messages/history',()=>({readMessageHistory:mock.read}))
vi.mock('@/lib/email/send',()=>({sendEmail:vi.fn()}))
import { acknowledgeMessages, loadOlderMessages } from '@/app/(portal)/messages/actions'
const matter='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
beforeEach(()=>{
  vi.clearAllMocks()
  mock.getUser.mockResolvedValue({data:{user:{id:'client-a'}}})
  mock.matter.mockResolvedValue({id:matter})
  const query={update:()=>query,eq:mock.eq.mockReturnThis(),neq:()=>query,is:()=>query,in:mock.ids.mockResolvedValue({error:null})}
  mock.eq.mockImplementation(()=>query)
  mock.from.mockReturnValue(query)
})
describe('portal displayed-message authorization',()=>{
  it('rejects an unauthenticated read before accessing history',async()=>{
    mock.getUser.mockResolvedValue({data:{user:null}})
    await expect(loadOlderMessages(matter,{id,createdAt:'2026-09-10T12:00:00Z'})).rejects.toThrow('Not authenticated')
    expect(mock.read).not.toHaveBeenCalled()
  })
  it('rejects another client matter before any privileged write',async()=>{
    mock.matter.mockResolvedValue({id:'other-matter'})
    await expect(acknowledgeMessages(matter,[id])).rejects.toThrow('Matter access required')
    expect(mock.from).not.toHaveBeenCalled()
  })
  it('acknowledges only supplied IDs inside the owned matter',async()=>{
    await acknowledgeMessages(matter,[id])
    expect(mock.eq).toHaveBeenCalledWith('matter_id',matter)
    expect(mock.ids).toHaveBeenCalledWith('id',[id])
  })
})
