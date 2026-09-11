'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BillingMatterOption } from '@/components/billing/AddChargeDialog'
export function BillingMatterPicker({id,value,onChange,initialOptions,disabled=false}:{id:string;value:string;onChange:(id:string,hasLegalFee?:boolean)=>void;initialOptions:BillingMatterOption[];disabled?:boolean}) {
  const [query,setQuery]=useState(''),[options,setOptions]=useState(initialOptions),[error,setError]=useState(false),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{
    if(initialOptions.length>0 && !query && (!value || initialOptions.some(option=>option.id===value))) {setOptions(initialOptions);setError(false);setLoading(false);return}
    const abort=new AbortController()
    const timer=setTimeout(()=>{
      setLoading(true);setError(false)
      const params=new URLSearchParams({q:query,...(value ? {selected:value} : {})})
      void fetch(`/api/admin/billing/matters?${params}`,{signal:abort.signal}).then(async response=>{
        if(!response.ok) throw new Error('Matter choices unavailable')
        const result=await response.json() as {matters:BillingMatterOption[]}
        if(!abort.signal.aborted) setOptions(result.matters)
      }).catch(()=>{if(!abort.signal.aborted) setError(true)}).finally(()=>{if(!abort.signal.aborted) setLoading(false)})
    },250)
    return ()=>{abort.abort();clearTimeout(timer)}
  },[query,value,initialOptions,retry])
  return <div className="space-y-2">
    {!disabled && <Input aria-label="Search all billing matters" placeholder="Search all matters by name or number…" value={query} onChange={event=>setQuery(event.target.value)} />}
    <Select value={value} onValueChange={id=>onChange(id,options.find(option=>option.id===id)?.hasLegalFee)} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Matter" className="min-h-11 w-full"><SelectValue placeholder="Choose a matter" /></SelectTrigger>
      <SelectContent>{options.map(option=><SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    {loading && <p role="status" className="text-xs">Searching matters…</p>}
    {error && <p role="alert" className="text-xs">Matter search failed. <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    {!disabled && options.length>=100 && <p className="text-xs text-muted-foreground">Showing up to 100 matches. Narrow your search to find another matter.</p>}
  </div>
}
