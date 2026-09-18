import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { LeadNoteRow, LeadTimelineNote } from '@/lib/leads/timeline'
const dto=(r:LeadNoteRow):LeadTimelineNote=>({id:r.id,body:r.body,actorId:r.actor_id,createdAt:r.created_at,updatedAt:r.updated_at})
const failure=(e:{message:string;code?:string})=>Response.json({error:e.message},{status:e.code==='42501'?403:e.code==='P0002'?404:500})
export async function PATCH(req:Request,{params}:{params:Promise<{id:string;noteId:string}>}){const {err,userId}=await requireAdmin(req);if(err)return err;const {id,noteId}=await params,input=await req.json().catch(()=>({}));const body=typeof input.body==='string'?input.body.trim():'';if(!body)return Response.json({error:'Note is required'},{status:400});const {data,error}=await getAdminClient().rpc('update_lead_note_with_activity',{p_lead_id:id,p_note_id:noteId,p_body:body,p_actor_id:userId});return error?failure(error):Response.json({note:dto(data)})}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string;noteId:string}>}){const {err,userId}=await requireAdmin(req);if(err)return err;const {id,noteId}=await params;const {error}=await getAdminClient().rpc('delete_lead_note_with_activity',{p_lead_id:id,p_note_id:noteId,p_actor_id:userId});return error?failure(error):Response.json({ok:true})}
