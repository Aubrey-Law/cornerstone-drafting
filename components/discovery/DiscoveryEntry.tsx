'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { callSchema, type DiscoveryCall } from '@/lib/discovery/contracts'
export function DiscoveryEntry({ leadId, calls = [], available = false }: { leadId:string; calls?:DiscoveryCall[]; available?:boolean }) {
  const router=useRouter()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const draft=calls.find(c=>c.status==='draft')
  async function start(){setBusy(true);setError('');try{
    const res=await fetch(`/api/admin/leads/${leadId}/discovery-calls`,{method:'POST'})
    if(!res.ok)throw new Error('Could not start this call. Please retry.')
    const {call}=z.object({call:callSchema}).parse(await res.json())
    router.push(`/admin/crm/opportunities/${leadId}/discovery/${call.id}`)
  }catch(e){setError(e instanceof Error?e.message:'Could not start call');setBusy(false)}}
  return <section aria-label="Discovery calls" className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Discovery call</h2><p className="text-sm text-muted-foreground">Internal screening and next action.</p></div>
      {draft?<Button asChild><Link href={`/admin/crm/opportunities/${leadId}/discovery/${draft.id}`}>Resume call</Link></Button>:<Button disabled={!available||busy} onClick={()=>void start()}>{busy?'Starting…':'Start discovery call'}</Button>}
    </div>
    {error&&<p role="status" className="text-sm text-muted-foreground">{error}</p>}
    {calls.filter(c=>c.status==='completed').map(call=><p key={call.id} className="text-sm"><Link className="underline" href={`/admin/crm/opportunities/${leadId}/discovery/${call.id}`}>Discovery call · {new Date(call.completed_at!).toLocaleDateString('en-US',{timeZone:'America/New_York'})}</Link></p>)}
  </section>
}
