import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const {requireAdmin,rpc}=vi.hoisted(()=>({requireAdmin:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc }) }))

import { POST as createNote } from '@/app/api/admin/leads/[id]/notes/route'
import { PATCH, DELETE } from '@/app/api/admin/leads/[id]/notes/[noteId]/route'
import { POST as createMeeting } from '@/app/api/admin/leads/[id]/meeting-notes/route'

const req=(body:unknown)=>new Request('http://localhost/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const note={id:'n1',body:'Body',note_type:'internal',actor_id:'u1',created_at:'2026-07-01T00:00:00Z',updated_at:'2026-07-01T00:00:00Z'}

beforeEach(()=>{vi.clearAllMocks();requireAdmin.mockResolvedValue({err:null,userId:'u1'});rpc.mockResolvedValue({data:note,error:null})})

describe('lead note handlers',()=>{
 it('defines each mutation and activity write inside one database RPC transaction',()=>{const sql=fs.readFileSync('supabase/migrations/20260713020923_atomic_lead_notes.sql','utf8');for(const fn of ['create_lead_note_with_activity','update_lead_note_with_activity','delete_lead_note_with_activity','create_lead_meeting_note_with_activity','import_lead_granola_note_with_activity'])expect(sql).toContain(`function public.${fn}`);expect(sql.match(/insert into public\.lead_activity/g)).toHaveLength(5);expect(sql).toContain("v.actor_id<>p_actor_id and v_role<>'admin'");expect(sql).not.toContain('update public.lead_notes set actor_id')})
 it('adds the note type as a real column, and leaves no untyped RPC behind',()=>{
  const sql=fs.readFileSync('supabase/migrations/20261219000000_lead_note_type.sql','utf8')
  expect(sql).toContain('add column if not exists note_type text not null default \'internal\'')
  expect(sql).toContain("check (note_type in ('internal','client_comm'))")
  // The old three-argument create is dropped, so no caller can write a note
  // whose type nobody chose.
  expect(sql).toContain('drop function if exists public.create_lead_note_with_activity(uuid,text,uuid);')
  expect(sql).toContain('drop function if exists public.update_lead_note_with_activity(uuid,uuid,text,uuid);')
  for(const signature of ['public.create_lead_note_with_activity(uuid,text,uuid,text)','public.update_lead_note_with_activity(uuid,uuid,text,uuid,text)']){
   expect(sql).toContain(signature)
  }
  expect(sql).toContain('revoke all on function')
  expect(sql).toContain('to service_role')
  // An edit that names no type keeps the note's own.
  expect(sql).toContain('note_type=coalesce(p_note_type,note_type)')
 })
 it('uses atomic RPCs and returns exact immutable-provenance DTOs',async()=>{
  const created=await createNote(req({body:' Body ',actorId:'spoof'}),{params:Promise.resolve({id:'l1'})});expect(await created.json()).toEqual({note:{id:'n1',body:'Body',noteType:'internal',actorId:'u1',createdAt:note.created_at,updatedAt:note.updated_at}});expect(rpc).toHaveBeenCalledWith('create_lead_note_with_activity',{p_lead_id:'l1',p_body:'Body',p_actor_id:'u1',p_note_type:'internal'})
  const updated=await PATCH(req({body:'Changed',actorId:'spoof'}),{params:Promise.resolve({id:'l1',noteId:'n1'})});expect(updated.status).toBe(200);expect(rpc).toHaveBeenCalledWith('update_lead_note_with_activity',{p_lead_id:'l1',p_note_id:'n1',p_body:'Changed',p_actor_id:'u1'})
  const deleted=await DELETE(req({}),{params:Promise.resolve({id:'l1',noteId:'n1'})});expect(deleted.status).toBe(200);expect(rpc).toHaveBeenCalledWith('delete_lead_note_with_activity',{p_lead_id:'l1',p_note_id:'n1',p_actor_id:'u1'})
 })
 it('propagates authorization, ownership, not-found, and transaction failures',async()=>{
  requireAdmin.mockResolvedValueOnce({err:Response.json({error:'Forbidden'},{status:403}),userId:null});expect((await createNote(req({body:'x'}),{params:Promise.resolve({id:'l1'})})).status).toBe(403)
  for(const code of ['42501','P0002','XX000']){rpc.mockResolvedValueOnce({data:null,error:{code,message:'failed'}});const res=await PATCH(req({body:'x'}),{params:Promise.resolve({id:'l1',noteId:'n1'})});expect(res.status).toBe(code==='42501'?403:code==='P0002'?404:500)}
 })
 it('carries the note type, defaults it to internal, and refuses one it does not know',async()=>{
  const clientComm={...note,note_type:'client_comm'};rpc.mockResolvedValueOnce({data:clientComm,error:null})
  const created=await createNote(req({body:'Called the client',noteType:'client_comm'}),{params:Promise.resolve({id:'l1'})})
  expect((await created.json()).note.noteType).toBe('client_comm')
  expect(rpc).toHaveBeenCalledWith('create_lead_note_with_activity',{p_lead_id:'l1',p_body:'Called the client',p_actor_id:'u1',p_note_type:'client_comm'})

  // An edit that names no type leaves the note's own type alone, so the RPC is
  // called without the argument rather than with a default that reclassifies it.
  await PATCH(req({body:'Changed'}),{params:Promise.resolve({id:'l1',noteId:'n1'})})
  expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_note_type')
  await PATCH(req({body:'Changed',noteType:'client_comm'}),{params:Promise.resolve({id:'l1',noteId:'n1'})})
  expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_note_type:'client_comm'})

  for(const handler of [
   ()=>createNote(req({body:'x',noteType:'gossip'}),{params:Promise.resolve({id:'l1'})}),
   ()=>PATCH(req({body:'x',noteType:'gossip'}),{params:Promise.resolve({id:'l1',noteId:'n1'})}),
  ]){const before=rpc.mock.calls.length;const res=await handler();expect(res.status).toBe(400);expect(rpc.mock.calls.length).toBe(before)}
 })
 it('maps a row written before the column existed to an internal note',async()=>{
  const {note_type:_dropped,...legacy}=note;rpc.mockResolvedValueOnce({data:legacy,error:null})
  const created=await createNote(req({body:'Body'}),{params:Promise.resolve({id:'l1'})})
  expect((await created.json()).note.noteType).toBe('internal')
 })
 it('strictly validates meeting date and attendees and fixes manual provenance',async()=>{
  for(const meetingDate of [undefined,3,{},'2026-02-30','not-a-date']){const res=await createMeeting(req({title:'Call',body:'Notes',meetingDate,attendees:['Jane']}),{params:Promise.resolve({id:'l1'})});expect(res.status).toBe(400)}
  expect((await createMeeting(req({title:'Call',body:'Notes',meetingDate:'2026-07-01',attendees:'Jane'}),{params:Promise.resolve({id:'l1'})})).status).toBe(400)
  rpc.mockResolvedValueOnce({data:{...note,title:'Call',meeting_date:'2026-07-01T00:00:00Z',attendees:['Jane'],source:'manual',granola_note_id:null},error:null});const res=await createMeeting(req({title:'Call',body:'Notes',meetingDate:'2026-07-01',attendees:[' Jane '],source:'granola',granolaNoteId:'spoof'}),{params:Promise.resolve({id:'l1'})});const json=await res.json();expect(json.meetingNote).toMatchObject({date:'2026-07-01T00:00:00Z',source:'manual',granolaNoteId:null});expect(json.meetingNote).not.toHaveProperty('meetingDate');expect(rpc).toHaveBeenCalledWith('create_lead_meeting_note_with_activity',expect.objectContaining({p_attendees:['Jane'],p_actor_id:'u1'}))
 })
})
