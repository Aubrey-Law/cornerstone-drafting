'use client'
import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction } from '@/components/ui/alert-dialog'
import { CompiledIntakeSections } from '@/components/intake/formEngine/CompiledIntakeSections'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import { intakeFormDefinitionSchema } from '@/lib/intake/forms/schema'
import { amendmentRowSchema,callSchema,type DiscoveryAnswers } from '@/lib/discovery/contracts'
import { FACT_LABELS, FACT_FIELDS } from '@/lib/discovery/facts'
import { useDiscoveryDeparture } from './useDiscoveryDeparture'
import { DiscoveryNextAction } from './DiscoveryNextAction'
const detailSchema=z.object({actorNames:z.record(z.string()).optional(),call:callSchema,definition:intakeFormDefinitionSchema,amendments:z.array(amendmentRowSchema),facts:z.record(z.unknown()),proposals:z.array(z.object({field:z.enum(FACT_FIELDS),current:z.unknown(),proposed:z.unknown()}))}).strict()
type Detail=z.infer<typeof detailSchema>
async function request(url:string,method='GET',body?:unknown){
 const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const value:unknown=await res.json().catch(()=>null)
 if(!res.ok){const error=z.object({error:z.string(),fieldErrors:z.record(z.array(z.string())).optional()}).passthrough().safeParse(value);throw new Error(error.success?`${error.data.error} ${Object.values(error.data.fieldErrors??{}).flat().join(' ')}`.trim():'Could not save. Your changes are preserved.')}
 return value
}
function display(value:unknown):string {if(value==null||value==='')return 'Not recorded';if(typeof value==='boolean')return value?'Yes':'No';if(typeof value==='object')return Object.entries(value).map(([key,v])=>`${({firstName:'First name',lastName:'Last name',middleName:'Middle name',preferredName:'Preferred name',dateOfBirth:'Date of birth',addressLine1:'Street',addressLine2:'Address line 2'} as Record<string,string>)[key] ?? key.replace(/^./,c=>c.toUpperCase())}: ${display(v)}`).join('\n');return String(value)}
export function DiscoveryWorkspace({leadId,callId}:{leadId:string;callId:string}) {
 const base=`/api/admin/leads/${leadId}/discovery-calls/${callId}`
 const [detail,setDetail]=useState<Detail|null>(null),[answers,setAnswers]=useState<DiscoveryAnswers>({}),[saved,setSaved]=useState<DiscoveryAnswers>({})
 const [status,setStatus]=useState<'idle'|'saving'|'error'>('idle'),[error,setError]=useState(''),[openId,setOpenId]=useState('call'),[showValidation,setShowValidation]=useState(false)
 const [selected,setSelected]=useState<string[]>([]),[amendment,setAmendment]=useState(''),[actionBusy,setActionBusy]=useState(false),[completing,setCompleting]=useState(false),[reloadConfirm,setReloadConfirm]=useState(false)
 const lock=useRef(false),latest=useRef(answers),revision=useRef(0)
 const dirty=JSON.stringify(answers)!==JSON.stringify(saved)
 const guard=useDiscoveryDeparture(dirty||status==='saving'||amendment.trim().length>0||actionBusy)
 const load=useCallback(async()=>{const result=detailSchema.parse(await request(base));setDetail(result);setAnswers(result.call.answers);latest.current=result.call.answers;setSaved(result.call.answers);revision.current=result.call.revision;setSelected([]);setStatus('idle');setError('')},[base])
 useEffect(()=>{let active=true;request(base).then(raw=>{if(!active)return;const result=detailSchema.parse(raw);setDetail(result);setAnswers(result.call.answers);latest.current=result.call.answers;setSaved(result.call.answers);revision.current=result.call.revision}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[base])
 const save=useCallback(async(complete=false)=>{
  if(lock.current)return false
  lock.current=true;setCompleting(complete);setStatus('saving');setError('')
  const snapshot=latest.current
  try {const result=z.object({call:callSchema}).strict().parse(await request(complete?`${base}/complete`:base,complete?'POST':'PATCH',{revision:revision.current,answers:snapshot}));revision.current=result.call.revision;setSaved(snapshot);setDetail(prev=>prev?{...prev,call:result.call}:prev);setStatus('idle');if(complete)await load();return true}
  catch(e){setError(e instanceof Error?e.message:'Save failed');setStatus('error');return false}finally{lock.current=false;setCompleting(false)}
 },[base,load])
 useEffect(()=>{if(!dirty||status!=='idle'||detail?.call.status!=='draft')return;const timer=setTimeout(()=>void save(),800);return()=>clearTimeout(timer)},[dirty,status,answers,detail?.call.status,save])
 const compiled=useMemo(()=>detail?compileIntakeForm(detail.definition,'staff'):null,[detail])
 const evaluation=useMemo(()=>compiled?.success?evaluateCompiledIntakeForm(compiled.form,answers):null,[compiled,answers])
 const completed=detail?.call.status==='completed'
 async function apply(){setActionBusy(true);setError('');try{const next=detailSchema.parse(await request(`${base}/apply-facts`,'POST',{changes:detail!.proposals.filter(p=>selected.includes(p.field)).map(p=>({field:p.field,expected:p.current}))}));setDetail(next);setSelected([])}catch(e){setError(e instanceof Error?e.message:'Could not apply changes')}finally{setActionBusy(false)}}
 async function amend(){setActionBusy(true);setError('');try{await request(`${base}/amend`,'POST',{body:amendment});setAmendment('');await load()}catch(e){setError(e instanceof Error?e.message:'Could not add amendment')}finally{setActionBusy(false)}}
 return <div className="guided-interview guided-zinc mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
  <Link className="text-sm underline" href={`/admin/crm/opportunities/${leadId}`}>Back to lead</Link>
  <header><h1 className="text-2xl font-semibold">Discovery call</h1><p className="text-sm text-muted-foreground">Internal only · {completed?'Completed — corrections are recorded as amendments':'Draft — freely move between sections'}</p></header>
  {error&&<div role="alert" className="space-y-2 rounded-lg border border-destructive p-3"><p>{error}</p>{!detail?<Button onClick={()=>void load().catch(e=>setError(e.message))}>Retry loading</Button>:<>{!completed&&status==='error'&&<Button variant="outline" disabled={actionBusy} onClick={()=>void save()}>Retry save</Button>}<Button variant="outline" onClick={()=>setReloadConfirm(true)} disabled={actionBusy||status==='saving'}>Reload current values</Button>{dirty&&<Button variant="outline" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(answers,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='discovery-unsaved.json';link.click();URL.revokeObjectURL(url)}}>Export unsaved answers</Button>}{dirty&&<p className="text-sm">Reloading replaces your local answers. You can keep editing or export them first.</p>}</>}</div>}
  {!detail&&!error&&<p role="status">Loading call…</p>}
  {detail&&compiled?.success&&evaluation&&<>
   <nav aria-label="Discovery sections" className="flex flex-wrap gap-2">{evaluation.activeSections.map(section=><Button key={section.id} size="sm" variant={openId===section.id?'default':'outline'} onClick={()=>setOpenId(section.id)}>{section.title}</Button>)}</nav>
   <CompiledIntakeSections form={compiled.form} evaluation={evaluation} data={answers} mode="staff" readOnly={completed||completing} openId={openId} onToggle={setOpenId} showValidation={showValidation} update={(field,value)=>{if(completed||completing)return;const next={...latest.current,[field]:value as DiscoveryAnswers[string]};latest.current=next;setAnswers(next);if(status==='error')setStatus('idle')}} onEditSection={setOpenId} />
   {!completed&&<div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background/95 py-4">
    <span role="status" className="text-sm">{status==='saving'?'Saving…':status==='error'?'Save failed':dirty?'Unsaved changes':'Saved'}</span>
    <Button variant="outline" disabled={status==='saving'} onClick={()=>void save()}>Save draft</Button>
    <Button disabled={status==='saving'} onClick={()=>{setShowValidation(true);const issue=evaluation.issues.find(issue=>issue.severity==='error');if(issue){setOpenId(issue.sectionId);setError(issue.message);return}if(answers.discovery_next_action==='no_further_action'&&!String(answers.discovery_action_reason??'').trim()){setOpenId('outcome');setError('Give a reason for no further action.');return}void save(true)}}>Complete call</Button>
   </div>}
   {completed&&<>
    <DiscoveryNextAction call={detail.call} name={[detail.facts.firstName,detail.facts.lastName].filter(Boolean).join(' ')} email={String(detail.facts.email??'')} />
    <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">Review factual changes</h2><p className="text-sm text-muted-foreground">Only selected facts update the lead and organizer. Internal screening stays in this call.</p>
     {detail.proposals.length===0?<p>No factual changes to apply.</p>:<><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Apply</th><th>Field</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{detail.proposals.map(p=><tr key={p.field} className="border-t"><td className="p-2 align-top"><input aria-label={`Apply ${FACT_LABELS[p.field]}`} type="checkbox" checked={selected.includes(p.field)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,p.field]:prev.filter(f=>f!==p.field))} /></td><th className="p-2 align-top">{FACT_LABELS[p.field]}</th><td className="whitespace-pre-wrap p-2 align-top">{display(p.current)}</td><td className="whitespace-pre-wrap p-2 align-top">{display(p.proposed)}</td></tr>)}</tbody></table></div><Button disabled={!selected.length||actionBusy} onClick={()=>void apply()}>Apply selected facts</Button></>}
    </section>
    <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">Amendments</h2>{detail.amendments.map(a=><article key={a.id}><p className="whitespace-pre-wrap">{a.body}</p><p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-US',{timeZone:'America/New_York'})} ET · {detail.actorNames?.[a.actor_id] ?? 'Staff member'}</p></article>)}
     <label htmlFor="discovery-amendment" className="text-sm">Append a correction</label><Textarea id="discovery-amendment" value={amendment} onChange={e=>setAmendment(e.target.value)} /><Button disabled={!amendment.trim()||actionBusy} onClick={()=>void amend()}>Add amendment</Button>
    </section>
   </>}
  </>}
  <AlertDialog open={reloadConfirm} onOpenChange={setReloadConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reload current values?</AlertDialogTitle><AlertDialogDescription>Unsaved local answers will be replaced by the saved record. Export them first if you need to keep them.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={()=>void load().catch(e=>setError(e.message))}>Reload</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={guard.confirmingDeparture} onOpenChange={open=>{if(!open)guard.cancelDeparture()}}><AlertDialogContent onCloseAutoFocus={guard.restoreDepartureFocus}><AlertDialogHeader><AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your unsaved call changes will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={guard.cancelDeparture}>Stay</AlertDialogCancel><AlertDialogAction onClick={()=>void guard.confirmDeparture()}>Leave</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>
}
