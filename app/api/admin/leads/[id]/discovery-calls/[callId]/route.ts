import { requireAdminRoute } from '@/lib/discovery/http'
import { callDetail, saveCall } from '@/lib/discovery/service'
import { saveSchema } from '@/lib/discovery/contracts'
type Context = { params:Promise<{id:string;callId:string}> }
export const GET = (req:Request,{params}:Context) => requireAdminRoute(req,params,callDetail)
export const PATCH = (req:Request,{params}:Context) => requireAdminRoute(req,params,async (id,call,actor) => { const body=saveSchema.parse(await req.json());return {call:await saveCall(id,call,actor,body.revision,body.answers,false)} })
