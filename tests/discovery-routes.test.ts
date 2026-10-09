import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),save:vi.fn(),list:vi.fn(),available:vi.fn(),start:vi.fn()}))
vi.mock('@/lib/apiAuth',()=>({requireAdmin:mocks.auth}))
vi.mock('@/lib/discovery/service',()=>({DiscoveryError:class extends Error{},saveCall:mocks.save,listCalls:mocks.list,availableTemplate:mocks.available,startCall:mocks.start}))
import {POST as complete} from '@/app/api/admin/leads/[id]/discovery-calls/[callId]/complete/route'
import {GET,POST} from '@/app/api/admin/leads/[id]/discovery-calls/route'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',callId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({err:null,userId:id})})
describe('discovery route boundary',()=>{
 it.each([401,403])('denies access before reading calls (%s)',async status=>{
  mocks.auth.mockResolvedValue({err:new Response(null,{status}),userId:null})
  expect((await GET(new Request('https://local'),{params:Promise.resolve({id})})).status).toBe(status)
  expect(mocks.list).not.toHaveBeenCalled()
  expect((await POST(new Request('https://local',{method:'POST'}),{params:Promise.resolve({id})})).status).toBe(status)
  expect(mocks.start).not.toHaveBeenCalled()
 })
 it('validates revision and rejects extra completion properties',async()=>{
  const res=await complete(new Request('https://local',{method:'POST',body:JSON.stringify({revision:-1,answers:{},sendEmail:true})}),{params:Promise.resolve({id,callId})})
  expect(res.status).toBe(422);expect(mocks.save).not.toHaveBeenCalled()
 })
 it('passes the authenticated actor and explicit completion intent to the service',async()=>{
  mocks.save.mockResolvedValue({id:callId})
  const answers={discovery_call_at:'2026-10-09T10:00',discovery_outcome:'proceed',discovery_next_action:'send_organizer'}
  const res=await complete(new Request('https://local',{method:'POST',body:JSON.stringify({revision:3,answers})}),{params:Promise.resolve({id,callId})})
  expect(res.status).toBe(200);expect(mocks.save).toHaveBeenCalledWith(id,callId,id,3,answers,true)
 })
})
