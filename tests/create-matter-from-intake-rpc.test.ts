import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only',()=>({}))
vi.mock('@/lib/matterNumber',()=>({generateUniqueMatterNumber:vi.fn(async()=> '2026-EP-DOE-001')}))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded',()=>({ensureDesignSheetSeededFromIntake:vi.fn(async()=>undefined)}))

import { createMatterFromIntake } from '@/lib/matters/createFromIntake'

const intake={id:'l1',email:'jane@example.com',first_name:'Jane',last_name:'Doe',full_name:'Jane Doe',practice_area:'EP',user_id:null,client_user_id:null,engagement_provider:null,engagement_envelope_id:null,engagement_status:null,engagement_sent_at:null,engagement_signed_at:null,engagement_fee_quoted:4500,lead_status:'lead'}

function adminWith(rpcResult:{data:any;error:any}) {
  const tables:string[]=[]
  const rpc=vi.fn(async()=>rpcResult)
  const admin:any={rpc,from:vi.fn((table:string)=>{tables.push(table);const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:intake,error:null}),insert:async()=>({error:null})};return chain})}
  return {admin,rpc,tables}
}

beforeEach(()=>vi.clearAllMocks())

describe('createMatterFromIntake transactional core',()=>{
  it('propagates RPC errors without separate core writes',async()=>{const {admin,rpc,tables}=adminWith({data:null,error:{message:'transaction failed'}});expect(await createMatterFromIntake(admin,'l1')).toEqual({ok:false,error:'transaction failed'});expect(rpc).toHaveBeenCalledTimes(1);expect(tables.filter(t=>['matters','matter_details'].includes(t))).toEqual([])})
  it('returns an existing matter idempotently from the RPC',async()=>{const {admin,rpc}=adminWith({data:{matter_id:'m1',matter_number:'2025-EP-1',created:false},error:null});expect(await createMatterFromIntake(admin,'l1')).toEqual({ok:true,matterId:'m1',matterNumber:'2025-EP-1'});expect(rpc).toHaveBeenCalledWith('convert_lead_to_matter',expect.objectContaining({p_lead_id:'l1'}))})
  it('creates through one RPC and performs no separate matter/details/link writes',async()=>{const {admin,rpc,tables}=adminWith({data:{matter_id:'m2',matter_number:'2026-EP-DOE-001',created:true},error:null});expect((await createMatterFromIntake(admin,'l1')).ok).toBe(true);expect(rpc).toHaveBeenCalledTimes(1);expect(tables.filter(t=>['matters','matter_details','client_intake'].includes(t))).toEqual(['client_intake'])})
})
