import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { DiscoveryError } from './service'
export async function requireAdminRoute(req:Request, params:Promise<{id:string;callId?:string}>, run:(leadId:string,callId:string,actorId:string)=>Promise<unknown>) {
  const {err,userId}=await requireAdmin(req)
  if(err)return err
  try {
    const {id,callId}=await params
    z.string().uuid().parse(id);if(callId)z.string().uuid().parse(callId)
    return Response.json(await run(id,callId ?? '',userId!),{headers:{'Cache-Control':'no-store'}})
  } catch(error) {
    if(error instanceof z.ZodError)return Response.json({error:'Check the highlighted answers.',fieldErrors:error.flatten().fieldErrors},{status:422})
    if(error instanceof DiscoveryError)return Response.json({error:error.message},{status:error.status})
    return Response.json({error:'Unable to load or save discovery call.'},{status:503})
  }
}
