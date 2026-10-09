import { requireAdminRoute } from '@/lib/discovery/http'
import { amendmentSchema } from '@/lib/discovery/contracts'
import { amendCall } from '@/lib/discovery/service'
type Context={params:Promise<{id:string;callId:string}>}
export const POST=(req:Request,{params}:Context)=>requireAdminRoute(req,params,async(id,call,actor)=>{ const body=amendmentSchema.parse(await req.json());return amendCall(id,call,actor,body.body) })
