import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getCachedClaims,getCachedUserRole } from '@/lib/supabaseServer'
import { DiscoveryWorkspace } from '@/components/discovery/DiscoveryWorkspace'
export const dynamic='force-dynamic'
export default async function Page({params}:{params:Promise<{id:string;callId:string}>}) {
 const claims=await getCachedClaims()
 if(!claims||!['admin','attorney'].includes((await getCachedUserRole(claims.id))??''))notFound()
 const {id,callId}=await params
 if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(callId).success)notFound()
 return <DiscoveryWorkspace leadId={id} callId={callId} />
}
