import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { LeadNoteRow, LeadTimelineNote } from '@/lib/leads/timeline'
const dto=(r:LeadNoteRow):LeadTimelineNote=>({id:r.id,body:r.body,actorId:r.actor_id,createdAt:r.created_at,updatedAt:r.updated_at})
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){const {err,userId}=await requireAdmin(req);if(err)return err;const {id}=await params,input=await req.json().catch(()=>({}));const body=typeof input.body==='string'?input.body.trim():'';if(!body)return Response.json({error:'Note is required'},{status:400});const {data,error}=await getAdminClient().rpc('create_lead_note_with_activity',{p_lead_id:id,p_body:body,p_actor_id:userId});if(error)return Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='P0002'?404:500});return Response.json({note:dto(data)})}
