import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createMatter: vi.fn(), admin: null as any }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('@/lib/matters/createFromIntake', () => ({ createMatterFromIntake: mocks.createMatter }))
vi.mock('@/lib/leads/deleteLead', () => ({ deleteLead: vi.fn() }))

import { PATCH } from '@/app/api/admin/leads/[id]/route'
import { newestTimestamp } from '@/lib/leads/timeline'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const valid = { firstName:'Jane',middleName:'',lastName:'Doe',preferredName:'',email:'jane@example.com',phone:'',dateOfBirth:'',addressLine1:'',addressLine2:'',city:'',state:'',zip:'',county:'',maritalStatus:'married',practiceArea:'EP',source:'Referral',status:'lead',fee:4500,spouse:null }

const snapshotLead = {
  id:'l1',matter_id:'m1',lead_status:'lead',first_name:'Jane',middle_name:null,last_name:'Doe',
  preferred_name:null,email:'jane@example.com',phone:'617-555-0100',date_of_birth:null,
  address_line1:'10 Main St',address_line2:null,city:'Boston',state:'MA',zip:'02108',county:'Suffolk',
  marital_status:'married',practice_area:'EP',lead_source:'Referral',engagement_fee_quoted:4500,
  lead_urgency:'normal',taxable_estate:2000000,has_minor_children:true,qualification_notes:'Qualified',
}
const snapshotSpouse = {first_name:'John',middle_name:null,last_name:'Doe',preferred_name:null,email:'john@example.com',phone:null,date_of_birth:null}

function harness({
  lead={id:'l1',matter_id:null,lead_status:'lead'} as any,
  finalLead=lead as any,
  spouse=null as any,
  opportunity=null as any,
  rpcError=null as null|{message:string;code?:string},
  rpcData,
  readErrors={},
  postReadErrors={},
}: {
  lead?:any
  finalLead?:any
  spouse?:any
  opportunity?:any
  rpcError?:null|{message:string;code?:string}
  rpcData?:any
  readErrors?:Record<string,{message:string}>
  postReadErrors?:Record<string,{message:string}>
}={}) {
  const calls:{rpc:any[];updates:any[];deletes:string[];filters:any[];inserts:any[]}=
    {rpc:[],updates:[],deletes:[],filters:[],inserts:[]}
  const maybeSingleCounts:Record<string,number>={}
  const admin={
    rpc:vi.fn(async (name:string,args:any)=>{calls.rpc.push([name,args]);return {data:rpcData ?? {...lead,lead_status:args.p_details?.status ?? lead?.lead_status},error:rpcError}}),
    from:vi.fn((table:string)=>{
      // loadSpouseContact reads the join first, then the contact by id — see
      // step 3 of docs/matter-contacts-migration.md.
      const row=table==='client_intake'?lead
        :table==='matters'?opportunity
        :table==='matter_contacts'?(spouse?{contact_id:spouse.id??'spouse-contact'}:null)
        :spouse
      const chain:any={
        select:()=>chain,
        eq:()=>chain,
        maybeSingle:async()=>{
          maybeSingleCounts[table]=(maybeSingleCounts[table]??0)+1
          const postError=maybeSingleCounts[table]>1?postReadErrors[table]:null
          return {data:postError?null:row,error:postError??readErrors[table]??null}
        },
        single:async()=>({
          data:postReadErrors[table]?null:table==='client_intake'?finalLead:row,
          error:postReadErrors[table]??null,
        }),
        update:(value:any)=>{calls.updates.push([table,value]);return chain},
        delete:()=>{calls.deletes.push(table);return chain},
        // The task-closeout sweep filters and inserts activity; see
        // lib/tasks/closeout.ts. `filters` is what its assertions read.
        in:(...args:any[])=>{calls.filters.push([table,'in',...args]);return chain},
        or:(...args:any[])=>{calls.filters.push([table,'or',...args]);return chain},
        not:(...args:any[])=>{calls.filters.push([table,'not',...args]);return chain},
        is:()=>chain,
        insert:async(value:any)=>{calls.inserts.push([table,value]);return {data:null,error:null}},
        then:(resolve:(v:any)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve),
      }
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
  it('validates a partial patch before database access',async()=>{
    const {admin,calls}=harness({lead:snapshotLead,spouse:snapshotSpouse,opportunity:{id:'m1',relationship_status:'lead'}})
    const res=await PATCH(request({field:'firstName',value:' '}),params)
    expect(res.status).toBe(400)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([])
  })
  it('sends only the normalized field to the atomic partial-update RPC',async()=>{
    const result={
      lead:{...snapshotLead,phone:'617-555-0111'},
      spouse:snapshotSpouse,
      activity:{id:'a1',event_type:'details_updated',created_at:'2026-07-25T12:00:00Z'},
    }
    const {admin,calls}=harness({rpcData:result})
    const res=await PATCH(request({field:'phone',value:'617-555-0111'}),params)
    expect(res.status).toBe(200)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([['update_lead_opportunity_field',{
      p_lead_id:'l1',
      p_field:'phone',
      p_value:'617-555-0111',
      p_actor_id:'u1',
    }]])
    expect(await res.json()).toEqual(result)
  })
  it('keeps disjoint concurrent field requests disjoint at the RPC boundary',async()=>{
    const {admin,calls}=harness({rpcData:{lead:snapshotLead,spouse:snapshotSpouse,activity:{id:'a1'}}})
    const [phoneResponse,sourceResponse]=await Promise.all([
      PATCH(request({field:'phone',value:'617-555-0111'}),params),
      PATCH(request({field:'source',value:'Website'}),params),
    ])
    expect(phoneResponse.status).toBe(200)
    expect(sourceResponse.status).toBe(200)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc.map(([,args])=>({field:args.p_field,value:args.p_value}))).toEqual([
      {field:'phone',value:'617-555-0111'},
      {field:'source',value:'Website'},
    ])
  })
  it('keeps a status transition disjoint from a concurrent scalar-field update',async()=>{
    const {admin,calls}=harness({rpcData:{lead:{...snapshotLead,lead_status:'lost'},spouse:snapshotSpouse,activity:{id:'a1'}}})
    const [statusResponse,fieldResponse]=await Promise.all([
      PATCH(request({status:'lost'}),params),
      PATCH(request({field:'phone',value:'617-555-0111'}),params),
    ])
    expect(statusResponse.status).toBe(200)
    expect(fieldResponse.status).toBe(200)
    // The lead's own tables are still untouched — everything about the lead
    // goes through the transactional RPC. `tasks` is the one direct write: the
    // closeout sweep, which runs on a different table after the transition has
    // committed. See lib/tasks/closeout.ts.
    expect(admin.from.mock.calls.map(([table]:[string])=>table)).toEqual(['tasks'])
    expect(calls.rpc).toEqual([
      ['update_lead_opportunity_status',{
        p_lead_id:'l1',
        p_status:'lost',
        p_actor_id:'u1',
      }],
      ['update_lead_opportunity_field',{
        p_lead_id:'l1',
        p_field:'phone',
        p_value:'617-555-0111',
        p_actor_id:'u1',
      }],
    ])
  })
  it('keeps a status transition disjoint from a concurrent spouse update',async()=>{
    const updatedSpouse={firstName:'John',middleName:null,lastName:'Doe',preferredName:'Jack',email:null,phone:null,dateOfBirth:null}
    const {admin,calls}=harness({rpcData:{lead:{...snapshotLead,lead_status:'lost'},spouse:updatedSpouse,activity:{id:'a1'}}})
    const [statusResponse,spouseResponse]=await Promise.all([
      PATCH(request({status:'lost'}),params),
      PATCH(request({field:'spouse',value:updatedSpouse}),params),
    ])
    expect(statusResponse.status).toBe(200)
    expect(spouseResponse.status).toBe(200)
    // The lead's own tables are still untouched — everything about the lead
    // goes through the transactional RPC. `tasks` is the one direct write: the
    // closeout sweep, which runs on a different table after the transition has
    // committed. See lib/tasks/closeout.ts.
    expect(admin.from.mock.calls.map(([table]:[string])=>table)).toEqual(['tasks'])
    expect(calls.rpc).toEqual([
      ['update_lead_opportunity_status',{
        p_lead_id:'l1',
        p_status:'lost',
        p_actor_id:'u1',
      }],
      ['update_lead_opportunity_field',{
        p_lead_id:'l1',
        p_field:'spouse',
        p_value:updatedSpouse,
        p_actor_id:'u1',
      }],
    ])
  })
  it.each([
    ['upserts',{firstName:'John',middleName:null,lastName:'Doe',preferredName:null,email:null,phone:null,dateOfBirth:null}],
    ['deletes',null],
  ])('%s spouse through the atomic partial-update RPC',async(_label,value)=>{
    const result={lead:snapshotLead,spouse:value,activity:{id:'a1'}}
    const {calls}=harness({rpcData:result})
    const res=await PATCH(request({field:'spouse',value}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc[0]).toEqual(['update_lead_opportunity_field',{
      p_lead_id:'l1',
      p_field:'spouse',
      p_value:value,
      p_actor_id:'u1',
    }])
  })
  it('rejects status as an inline field without invoking the update RPC',async()=>{
    const {calls}=harness({lead:snapshotLead,spouse:snapshotSpouse,opportunity:{id:'m1',relationship_status:'lead'}})
    const res=await PATCH(request({field:'status',value:'lost'}),params)
    expect(res.status).toBe(400)
    expect(calls.rpc).toEqual([])
  })
  it('rejects Hired on the status-only endpoint so conversion remains the only hiring path',async()=>{
    const {admin,calls}=harness()
    const res=await PATCH(request({status:'hired'}),params)
    expect(res.status).toBe(400)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([])
    expect(mocks.createMatter).not.toHaveBeenCalled()
  })
  it.each([
    ['null',null],
    ['non-object','10 Main St'],
  ])('rejects a %s address partial patch before database access',async(_label,value)=>{
    const {admin,calls}=harness()
    const res=await PATCH(request({field:'address',value}),params)
    expect(res.status).toBe(400)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([])
  })
  it.each([
    ['P0002 regardless of message',{code:'P0002',message:'missing row'}],
    ['canonical message without a code',{message:'Lead not found'}],
  ])('maps a missing lead from the partial RPC to 404 by %s',async(_label,rpcError)=>{
    const {calls}=harness({rpcError})
    const res=await PATCH(request({field:'phone',value:'617-555-0111'}),params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({error:rpcError.message})
    expect(calls.rpc).toHaveLength(1)
  })
  it('continues to support legacy complete status requests',async()=>{
    const {calls}=harness()
    const res=await PATCH(request({...valid,status:'lost'}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc[0][1].p_details.status).toBe('lost')
  })
  it('returns a committed legacy spouse projection instead of false null when the post-write spouse read fails',async()=>{
    const requestedSpouse={firstName:'John',middleName:null,lastName:'Doe',preferredName:'Jack',email:'john@example.com',phone:null,dateOfBirth:'1981-05-04'}
    const {calls}=harness({
      lead:snapshotLead,
      finalLead:{...snapshotLead,lead_status:'lost'},
      spouse:snapshotSpouse,
      opportunity:{id:'m1',relationship_status:'lead'},
      postReadErrors:{contacts:{message:'spouse refresh failed'}},
    })
    const res=await PATCH(request({...valid,status:'lost',spouse:requestedSpouse}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc[0][0]).toBe('update_lead_opportunity_details')
    expect(await res.json()).toMatchObject({
      spouse:{
        first_name:'John',
        middle_name:null,
        last_name:'Doe',
        preferred_name:'Jack',
        email:'john@example.com',
        phone:null,
        date_of_birth:'1981-05-04',
      },
      refreshWarning:'Saved, but refreshed spouse data is unavailable.',
    })
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
  it('clears a snooze through the same atomic RPC',async()=>{
    const result={lead:{id:'l1',lead_next_action_snoozed_until:null},activity:{id:'a1',event_type:'next_action_snooze_cleared'}}
    const {calls}=harness({rpcData:result})
    const res=await PATCH(request({nextActionSnoozedUntil:null}),params)
    expect(res.status).toBe(200)
    expect(calls.rpc).toEqual([['snooze_lead_next_action',{p_lead_id:'l1',p_until:null,p_actor_id:'u1'}]])
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

describe('lead detail workflow loader contract', () => {
  it('loads the soonest future non-cancelled appointment linked to this lead', () => {
    const page = source('app/admin/leads/[id]/page.tsx')
    expect(page).toMatch(
      /from\('appointments'\)[\s\S]*?select\('start_time'\)[\s\S]*?eq\('linked_lead_id', id\)[\s\S]*?gte\('start_time', new Date\(\)\.toISOString\(\)\)[\s\S]*?neq\('status', 'cancelled'\)[\s\S]*?order\('start_time', \{ ascending: true \}\)[\s\S]*?limit\(1\)[\s\S]*?maybeSingle\(\)/,
    )
  })

  it('resolves timeline actors with one users query and loads no calls', () => {
    const page = source('app/admin/leads/[id]/page.tsx')
    expect(page).not.toMatch(/from\('calls'\)/)
    expect(page.match(/from\('users'\)/g)).toHaveLength(1)
    expect(page).toMatch(/new Set\([\s\S]*?actor_id/)
    expect(page).toMatch(/select\('id, display_name, email'\)[\s\S]*?in\('id', actorIds\)/)
    expect(page).toMatch(/actorNames=\{actorNames\}/)
  })

  it('passes the hydrated whole intake row and workflow timestamps to the client', () => {
    const page = source('app/admin/leads/[id]/page.tsx')
    expect(page).toMatch(/lead=\{hydratedLead\}/)
    expect(page).toMatch(/nextAppointmentAt=\{nextAppointmentAt\}/)
    // A booking wins; the matter's milestones are the fallback, picked the way
    // v_lead_list picks them. tests/lead-detail-loader.test.ts holds the
    // behaviour — this holds the wiring.
    expect(page).toMatch(
      /appointment\?\.start_time[\s\S]{0,80}\?\? scoringAppointmentAt\(anchorRow\?\.discovery_call_at, anchorRow\?\.pmps_at\)/,
    )
    expect(page).toMatch(/lastTouchAt=\{lastTouchAt\}/)
    expect(page).not.toMatch(/lastTouchAt=\{lead\.updated_at\}/)
  })
})

describe('newestTimestamp', () => {
  it('selects the newest valid touch and ignores invalid or empty values', () => {
    expect(newestTimestamp([
      '2026-07-20T12:00:00Z',
      undefined,
      'not-a-date',
      null,
      '2026-07-24T08:00:00Z',
      '2026-07-22T16:30:00Z',
    ])).toBe('2026-07-24T08:00:00Z')
  })

  it('returns null when no valid touch timestamp exists', () => {
    expect(newestTimestamp([null, undefined, '', 'invalid'])).toBeNull()
  })
})

describe('lead editing surfaces', () => {
  it('rejects the legacy dialog payload rather than silently half-saving it', async () => {
    // The Edit dialog used to PATCH { clientName, ..., leadStatus }. That shape
    // matches none of the route's branches, so it fell through to the full
    // details validator and 400'd on a field the dialog never collected. The
    // dialog is create-only now; this pins the behaviour so nobody reintroduces
    // the shape expecting it to work.
    harness()
    const res = await PATCH(
      request({
        clientName: 'Jane Doe',
        clientEmail: 'jane@example.com',
        clientPhone: '',
        practiceArea: 'EP',
        feeQuoted: 4500,
        leadStatus: 'lost',
      }),
      params,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toMatchObject({ firstName: expect.any(String) })
  })

  it('accepts a status-only body for every settable lead state', async () => {
    for (const status of ['lead', 'lost', 'declined'] as const) {
      const { calls } = harness({ rpcData: { lead: snapshotLead, spouse: null, activity: null } })
      const res = await PATCH(request({ status }), params)
      expect(res.status, status).toBe(200)
      expect(calls.rpc[0]).toEqual([
        'update_lead_opportunity_status',
        { p_lead_id: 'l1', p_status: status, p_actor_id: 'u1' },
      ])
    }
  })

  it.each([
    ['lost', 'lead_lost'],
    ['declined', 'lead_declined'],
  ] as const)('archives the open tasks of a lead marked %s', async (status, reason) => {
    const { calls } = harness({ rpcData: { lead: snapshotLead, spouse: null, activity: null } })

    const res = await PATCH(request({ status }), params)

    expect(res.status).toBe(200)
    expect(calls.updates).toEqual([
      ['tasks', expect.objectContaining({ status: 'archived', closeout_reason: reason })],
    ])
    // Both columns a lead's tasks can hang off: the plan is generated against
    // the matter behind the opportunity, hand-added tasks carry the lead id.
    expect(calls.filters).toContainEqual(['tasks', 'or', 'matter_id.eq.m1,lead_id.eq.l1'])
  })

  it('puts the tasks back when a lead is returned to play', async () => {
    const { calls } = harness({ rpcData: { lead: snapshotLead, spouse: null, activity: null } })

    const res = await PATCH(request({ status: 'lead' }), params)

    expect(res.status).toBe(200)
    expect(calls.updates).toEqual([
      ['tasks', expect.objectContaining({ status: 'open', skipped_at: null, closeout_reason: null })],
    ])
    // Only what the sweep marked — a task skipped by hand stays skipped.
    expect(calls.filters).toContainEqual(['tasks', 'not', 'closeout_reason', 'is', null])
  })

  it('leaves the checklist alone when a lead converts', async () => {
    const { calls } = harness({ finalLead: { id: 'l1', matter_id: 'm1', lead_status: 'hired' } })

    await PATCH(request({ ...valid, status: 'hired' }), params)

    expect(calls.updates.filter(([table]: [string]) => table === 'tasks')).toEqual([])
  })

  it('still refuses a status the lifecycle does not allow to be set directly', async () => {
    harness()
    // Hiring runs through the convert endpoint, which assigns the matter number.
    const res = await PATCH(request({ status: 'hired' }), params)
    expect(res.status).toBe(400)
  })

  it('keeps the create dialog free of an edit path', () => {
    const dialog = source('components/leads/LeadEditorDialog.tsx')
    expect(dialog).not.toContain('editingLead')
    // The status select lived here and could never save; status is set from the
    // row menu, the detail header and the board instead.
    expect(dialog).not.toContain('Matter status')

    const client = source('app/admin/leads/LeadsClient.tsx')
    expect(client).not.toContain('payload.leadStatus')
    expect(client).toContain('const openEdit = (lead: LeadRow) => selectLead(lead.id)')
  })

  it('offers the status actions from the row menu', () => {
    const menu = source('components/leads/LeadActionsMenu.tsx')
    expect(menu).toContain("onStatusChange(lead, 'lost')")
    expect(menu).toContain("onStatusChange(lead, 'declined')")
    expect(menu).toContain("onStatusChange(lead, 'lead')")
  })
})
