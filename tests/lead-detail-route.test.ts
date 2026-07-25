import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createMatter: vi.fn(), admin: null as any }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('@/lib/matters/createFromIntake', () => ({ createMatterFromIntake: mocks.createMatter }))
vi.mock('@/lib/leads/deleteLead', () => ({ deleteLead: vi.fn() }))

import { PATCH } from '@/app/api/admin/leads/[id]/route'

const valid = { firstName:'Jane',middleName:'',lastName:'Doe',preferredName:'',email:'jane@example.com',phone:'',dateOfBirth:'',addressLine1:'',addressLine2:'',city:'',state:'',zip:'',county:'',maritalStatus:'married',practiceArea:'EP',source:'Referral',status:'lead',fee:4500,spouse:null }

const snapshotLead = {
  id:'l1',matter_id:'m1',lead_status:'lead',first_name:'Jane',middle_name:null,last_name:'Doe',
  preferred_name:null,email:'jane@example.com',phone:'617-555-0100',date_of_birth:null,
  address_line1:'10 Main St',address_line2:null,city:'Boston',state:'MA',zip:'02108',county:'Suffolk',
  marital_status:'married',practice_area:'EP',lead_source:'Referral',engagement_fee_quoted:4500,
  lead_urgency:'normal',taxable_estate:2000000,has_minor_children:true,qualification_notes:'Qualified',
}
const snapshotSpouse = {first_name:'John',middle_name:null,last_name:'Doe',preferred_name:null,email:'john@example.com',phone:null,date_of_birth:null}

function harness({ lead={id:'l1',matter_id:null,lead_status:'lead'} as any, finalLead=lead as any, spouse=null as any, opportunity=null as any, rpcError=null as null|{message:string}, rpcData }: {lead?:any;finalLead?:any;spouse?:any;opportunity?:any;rpcError?:null|{message:string};rpcData?:any}={}) {
  const calls:{rpc:any[];updates:any[];deletes:string[]}={rpc:[],updates:[],deletes:[]}
  const admin={
    rpc:vi.fn(async (name:string,args:any)=>{calls.rpc.push([name,args]);return {data:rpcData ?? {...lead,lead_status:args.p_details?.status ?? lead?.lead_status},error:rpcError}}),
    from:vi.fn((table:string)=>{
      const row=table==='client_intake'?lead:table==='matters'?opportunity:spouse
      const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:row,error:null}),single:async()=>({data:table==='client_intake'?finalLead:row,error:null}),update:(value:any)=>{calls.updates.push([table,value]);return chain},delete:()=>{calls.deletes.push(table);return chain}}
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
  it('rejects an update to a hired matter',async()=>{harness({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},opportunity:{id:'m1',relationship_status:'hired'}});const res=await PATCH(request({...valid,status:'lost'}),params);expect(res.status).toBe(409)})
  it('returns complete lead and spouse for repeated Hired',async()=>{const spouse={id:'s1',first_name:'John'};harness({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse,opportunity:{id:'m1',relationship_status:'hired'}});const res=await PATCH(request({...valid,status:'hired'}),params);expect(await res.json()).toEqual({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse,matterId:'m1'})})
  it.each([['creates',null],['updates',{firstName:'John',middleName:null,lastName:'Doe',preferredName:null,email:null,phone:null,dateOfBirth:null}],['deletes',null]])('%s spouse through the RPC payload',async(_label,spouse)=>{const {calls}=harness();await PATCH(request({...valid,spouse}),params);expect(calls.rpc[0][1].p_spouse).toEqual(spouse)})
  it('persists Lost without invoking conversion',async()=>{const {calls}=harness();const res=await PATCH(request({...valid,status:'lost'}),params);expect(res.status).toBe(200);expect(calls.rpc[0][1].p_details.status).toBe('lost');expect(mocks.createMatter).not.toHaveBeenCalled()})
  it('passes only the authenticated route actor to the service-role RPC',async()=>{const {calls}=harness();await PATCH(request(),params);expect(calls.rpc[0][1].p_actor_id).toBe('u1')})
  it('returns structured field errors',async()=>{harness();const res=await PATCH(request({...valid,firstName:'',email:'bad',fee:-1}),params);const json=await res.json();expect(res.status).toBe(400);expect(json.fieldErrors).toMatchObject({firstName:expect.any(String),email:expect.any(String),fee:expect.any(String)})})
  it('lets conversion alone persist Hired and returns the linked row and spouse',async()=>{const spouse={id:'s1'};const {calls}=harness({finalLead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse});const res=await PATCH(request({...valid,status:'hired'}),params);expect(calls.rpc[0][1].p_details.status).toBe('lead');expect(mocks.createMatter).toHaveBeenCalledTimes(1);expect(calls.updates).toEqual([]);expect(await res.json()).toEqual({lead:{id:'l1',matter_id:'m1',lead_status:'hired'},spouse,matterId:'m1'})})
  it('returns conversion failure without cleanup or a Hired persistence request',async()=>{const {calls}=harness();mocks.createMatter.mockResolvedValue({ok:false,error:'matter failed'});const res=await PATCH(request({...valid,status:'hired'}),params);expect(res.status).toBe(500);expect(calls.rpc[0][1].p_details.status).toBe('lead');expect(calls.updates).toEqual([]);expect(calls.deletes).toEqual([])})
  it('loads the trusted lead and spouse snapshot before validating a partial patch',async()=>{
    const {admin}=harness({lead:snapshotLead,spouse:snapshotSpouse,opportunity:{id:'m1',relationship_status:'lead'}})
    const res=await PATCH(request({field:'firstName',value:' '}),params)
    expect(res.status).toBe(400)
    expect(admin.from).toHaveBeenCalledWith('client_intake')
    expect(admin.from).toHaveBeenCalledWith('contacts')
  })
  it('sends only the complete merged server snapshot to the existing update RPC',async()=>{
    const {calls}=harness({lead:snapshotLead,spouse:snapshotSpouse,opportunity:{id:'m1',relationship_status:'lead'}})
    const res=await PATCH(request({field:'phone',value:'617-555-0111'}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc[0]).toEqual(['update_lead_opportunity_details',{
      p_lead_id:'l1',
      p_details:{
        firstName:'Jane',middleName:null,lastName:'Doe',preferredName:null,email:'jane@example.com',
        phone:'617-555-0111',dateOfBirth:null,addressLine1:'10 Main St',addressLine2:null,
        city:'Boston',state:'MA',zip:'02108',county:'Suffolk',maritalStatus:'married',
        practiceArea:'EP',source:'Referral',status:'lead',fee:4500,urgency:'normal',
        estimatedEstateValue:2000000,hasMinorChildren:true,qualificationNotes:'Qualified',
        spouse:{firstName:'John',middleName:null,lastName:'Doe',preferredName:null,email:'john@example.com',phone:null,dateOfBirth:null},
      },
      p_spouse:{firstName:'John',middleName:null,lastName:'Doe',preferredName:null,email:'john@example.com',phone:null,dateOfBirth:null},
      p_actor_id:'u1',
    }])
  })
  it('rejects status as an inline field without invoking the update RPC',async()=>{
    const {calls}=harness({lead:snapshotLead,spouse:snapshotSpouse,opportunity:{id:'m1',relationship_status:'lead'}})
    const res=await PATCH(request({field:'status',value:'lost'}),params)
    expect(res.status).toBe(400)
    expect(calls.rpc).toEqual([])
  })
  it('continues to support legacy complete status requests',async()=>{
    const {calls}=harness()
    const res=await PATCH(request({...valid,status:'lost'}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc[0][1].p_details.status).toBe('lost')
  })
  it('snoozes until a valid future ISO timestamp through the atomic RPC',async()=>{
    const until='2999-08-01T14:00:00.000Z'
    const result={lead:{id:'l1',lead_next_action_snoozed_until:until},activity:{id:'a1',event_type:'next_action_snoozed'}}
    const {calls}=harness({rpcData:result})
    const res=await PATCH(request({nextActionSnoozedUntil:until}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc).toEqual([['snooze_lead_next_action',{p_lead_id:'l1',p_until:until,p_actor_id:'u1'}]])
    expect(await res.json()).toEqual(result)
  })
  it.each([
    ['malformed','tomorrow'],
    ['past','2020-01-01T00:00:00.000Z'],
  ])('rejects a %s snooze timestamp before database access',async(_label,until)=>{
    const {admin,calls}=harness()
    const res=await PATCH(request({nextActionSnoozedUntil:until}),params)
    expect(res.status).toBe(400)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([])
  })
  it.each([
    ['missing lead','Lead not found'],
    ['converted lead','Next action is unavailable for this lead'],
  ])('returns the atomic snooze failure for a %s',async(_label,message)=>{
    const {calls}=harness({rpcError:{message}})
    const res=await PATCH(request({nextActionSnoozedUntil:'2999-08-01T14:00:00.000Z'}),params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({error:message})
    expect(calls.rpc).toHaveLength(1)
  })
})
