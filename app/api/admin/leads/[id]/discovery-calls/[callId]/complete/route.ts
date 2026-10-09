import { requireAdminRoute } from '@/lib/discovery/http'
import { saveSchema } from '@/lib/discovery/contracts'
import { saveCall } from '@/lib/discovery/service'
type Context={params:Promise<{id:string;callId:string}>}
export const POST=(req:Request,{params}:Context)=>requireAdminRoute(req,params,async(id,call,actor)=>{ const body=saveSchema.parse(await req.json());return {call:await saveCall(id,call,actor,body.revision,body.answers,true)} })
