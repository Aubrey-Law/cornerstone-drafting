import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createMatter: vi.fn(), admin: null as any }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('@/lib/matters/createFromIntake', () => ({ createMatterFromIntake: mocks.createMatter }))
vi.mock('@/lib/leads/deleteLead', () => ({ deleteLead: vi.fn() }))

import { PATCH } from '@/app/api/admin/leads/[id]/route'

const valid = { firstName:'Jane',middleName:'',lastName:'Doe',preferredName:'',email:'jane@example.com',phone:'',dateOfBirth:'',addressLine1:'',addressLine2:'',city:'',state:'',zip:'',county:'',maritalStatus:'married',practiceArea:'EP',source:'Referral',status:'lead',fee:4500,spouse:null }

function harness({ lead={id:'l1',matter_id:null,lead_status:'lead'}, finalLead=lead, spouse=null, rpcError=null as null|{message:string} }={}) {
  const calls:{rpc:any[];updates:any[];deletes:string[]}={rpc:[],updates:[],deletes:[]}
  const admin={
    rpc:vi.fn(async (name:string,args:any)=>{calls.rpc.push([name,args]);return {data:{...lead,lead_status:args.p_details.status},error:rpcError}}),
    from:vi.fn((table:string)=>{
      const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:table==='client_intake'?lead:spouse,error:null}),single:async()=>({data:table==='client_intake'?finalLead:spouse,error:null}),update:(value:any)=>{calls.updates.push([table,value]);return chain},delete:()=>{calls.deletes.push(table);return chain}}
      return chain
    }),
  }
  mocks.admin=admin
  return {admin,calls}
}
const request=(body:any=valid)=>new Request('http://test/api/admin/leads/l1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const params={params:Promise.resolve({id:'l1'})}

beforeEach(()=>{vi.clearAllMocks();mocks.requireAdmin.mockResolvedValue({err:null,userId:'u1'});mocks.createMatter.mockResolvedValue({ok:true,matterId:'m1',matterNumber:'1'})})

describe('lead details PATCH handler',()=>{
  it('returns the authorization response without touching storage',async()=>{const {admin}=harness();mocks.requireAdmin.mockResolvedValue({err:new Response('no',{status:401}),userId:null});const res=await PATCH(request(),params);expect(res.status).toBe(401);expect(admin.from).not.toHaveBeenCalled()})
  it('returns 404 for an unknown lead',async()=>{harness({lead:null as any});const res=await PATCH(request(),params);expect(res.status).toBe(404)})
  it('rejects a converted non-Hired update',async()=>{harness({lead:{id:'l1',matter_id:'m1',lead_status:'hired'}});const res=await PATCH(request({...valid,status:'lost'}),params);expect(res.status).toBe(409)})
  it('returns complete lead and spouse for repeated Hired',async()=>{const spouse={id:'s1',first_name:'John'};harness({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse});const res=await PATCH(request({...valid,status:'hired'}),params);expect(await res.json()).toEqual({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse,matterId:'m1'})})
  it.each([['creates',null],['updates',{firstName:'John',middleName:null,lastName:'Doe',preferredName:null,email:null,phone:null,dateOfBirth:null}],['deletes',null]])('%s spouse through the RPC payload',async(_label,spouse)=>{const {calls}=harness();await PATCH(request({...valid,spouse}),params);expect(calls.rpc[0][1].p_spouse).toEqual(spouse)})
  it('persists Lost without invoking conversion',async()=>{const {calls}=harness();const res=await PATCH(request({...valid,status:'lost'}),params);expect(res.status).toBe(200);expect(calls.rpc[0][1].p_details.status).toBe('lost');expect(mocks.createMatter).not.toHaveBeenCalled()})
  it('passes only the authenticated route actor to the service-role RPC',async()=>{const {calls}=harness();await PATCH(request(),params);expect(calls.rpc[0][1].p_actor_id).toBe('u1')})
  it('returns structured field errors',async()=>{harness();const res=await PATCH(request({...valid,firstName:'',email:'bad',fee:-1}),params);const json=await res.json();expect(res.status).toBe(400);expect(json.fieldErrors).toMatchObject({firstName:expect.any(String),email:expect.any(String),fee:expect.any(String)})})
  it('lets conversion alone persist Hired and returns the linked row and spouse',async()=>{const spouse={id:'s1'};const {calls}=harness({finalLead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse});const res=await PATCH(request({...valid,status:'hired'}),params);expect(calls.rpc[0][1].p_details.status).toBe('lead');expect(mocks.createMatter).toHaveBeenCalledTimes(1);expect(calls.updates).toEqual([]);expect(await res.json()).toEqual({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse,matterId:'m1'})})
  it('returns conversion failure without cleanup or a Hired persistence request',async()=>{const {calls}=harness();mocks.createMatter.mockResolvedValue({ok:false,error:'matter failed'});const res=await PATCH(request({...valid,status:'hired'}),params);expect(res.status).toBe(500);expect(calls.rpc[0][1].p_details.status).toBe('lead');expect(calls.updates).toEqual([]);expect(calls.deletes).toEqual([])})
})
