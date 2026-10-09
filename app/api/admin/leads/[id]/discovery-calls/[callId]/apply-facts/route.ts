import { requireAdminRoute } from '@/lib/discovery/http'
import { applyFactsSchema,applyFacts } from '@/lib/discovery/service'
type Context={params:Promise<{id:string;callId:string}>}
export const POST=(req:Request,{params}:Context)=>requireAdminRoute(req,params,async(id,call,actor)=>{ return applyFacts(id,call,actor,applyFactsSchema.parse(await req.json())) })
