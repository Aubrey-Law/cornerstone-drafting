'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function LeadDetailClient({ lead, spouse, initialActivity }: { lead: any; spouse: any; initialActivity: any[] }) {
  const token=useAccessToken(); const router=useRouter(); const [activity,setActivity]=useState(initialActivity); const [note,setNote]=useState(''); const [busy,setBusy]=useState(false)
  const call=async(path:string,body?:unknown)=>{const r=await fetch(path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error);return j}
  async function addNote(){if(!note.trim())return;setBusy(true);try{const j=await call(`/api/admin/leads/${lead.id}/activity`,{detail:note});setActivity((a:any[])=>[j.activity,...a]);setNote('')}finally{setBusy(false)}}
  async function convert(){setBusy(true);try{const j=await call(`/api/admin/leads/${lead.id}/convert`);router.push(`/admin/matters/${j.matterId}`)}finally{setBusy(false)}}
  async function intake(){setBusy(true);try{await call('/api/admin/intake/send',{intakeId:lead.id});router.refresh()}finally{setBusy(false)}}
  async function draft(){setBusy(true);try{const j=await call(`/api/admin/leads/${lead.id}/engagement-draft`);router.push(`/admin/engagements/${j.agreementId}?step=details`)}finally{setBusy(false)}}
  return <div className="space-y-6">
    <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-lg border p-5"><h2 className="font-semibold">Lead details</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt>Name</dt><dd>{lead.full_name}</dd><dt>Email</dt><dd>{lead.email}</dd><dt>Phone</dt><dd>{lead.phone||'—'}</dd><dt>Address</dt><dd>{[lead.address_line1,lead.city,lead.state,lead.zip].filter(Boolean).join(', ')||'—'}</dd><dt>Marital status</dt><dd>{lead.marital_status||'—'}</dd><dt>Spouse</dt><dd>{spouse?[spouse.first_name,spouse.last_name].filter(Boolean).join(' '):'—'}</dd><dt>Lead source</dt><dd>{lead.lead_source||'—'}</dd><dt>Fee</dt><dd>{lead.engagement_fee_quoted?`$${Number(lead.engagement_fee_quoted).toLocaleString()}`:'—'}</dd></dl><div className="mt-5 flex flex-wrap gap-2"><Button onClick={intake} disabled={busy}>{lead.intake_sent_at?'Resend intake':'Send intake'}</Button><Button variant="outline" onClick={draft} disabled={busy}>Draft engagement</Button><Button variant="outline" onClick={convert} disabled={busy}>Convert matter</Button></div></section>
    <section className="rounded-lg border p-5"><h2 className="font-semibold">Activity</h2><div className="mt-3 flex gap-2"><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a note"/><Button onClick={addNote} disabled={busy||!note.trim()}>Add</Button></div><div className="mt-4 space-y-3">{activity.map(row=><article key={row.id} className="border-l-2 pl-3 text-sm"><div className="font-medium">{row.title}</div>{row.detail&&<div className="text-muted-foreground">{row.detail}</div>}<time className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</time></article>)}{!activity.length&&<p className="text-sm text-muted-foreground">No activity yet.</p>}</div></section></div>
  </div>
}
