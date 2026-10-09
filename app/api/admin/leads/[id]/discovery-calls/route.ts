import { requireAdminRoute } from '@/lib/discovery/http'
import { listCalls, startCall, availableTemplate } from '@/lib/discovery/service'
type Context = { params:Promise<{id:string}> }
export const GET = (req:Request,{params}:Context) => requireAdminRoute(req,params,async id => ({ calls:await listCalls(id), available:Boolean(await availableTemplate()) }))
export const POST = (req:Request,{params}:Context) => requireAdminRoute(req,params,async (id,_,actor) => ({call:await startCall(id,actor)}))
