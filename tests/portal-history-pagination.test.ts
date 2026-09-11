import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readMessageHistory } from '@/lib/messages/history'
describe('portal history window', () => {
  it('returns newest 50 in display order and a stable older cursor', async () => {
    const calls: unknown[] = []
    const rows = Array.from({length:51}, (_,i)=>({id:String(51-i),created_at:'2026-09-10T12:00:00Z'}))
    const query = { select:()=>query,eq:(...args:unknown[])=>{calls.push(args);return query},order:(...args:unknown[])=>{calls.push(args);return query},limit:(n:number)=>{expect(n).toBe(51);return {data:rows,error:null}} }
    const page=await readMessageHistory({from:()=>query} as unknown as SupabaseClient,'matter-a')
    expect(page.messages[0].id).toBe('2')
    expect(page.messages.at(-1)?.id).toBe('51')
    expect(page.older?.id).toBe('2')
    expect(calls).toContainEqual(['matter_id','matter-a'])
    expect(calls).toContainEqual(['id',{ascending:false}])
  })
  it('rejects a cursor that could alter the record filter', async () => {
    const query={select:()=>query,eq:()=>query}
    await expect(readMessageHistory({from:()=>query} as unknown as SupabaseClient,'matter-a',{id:'x',createdAt:'x),matter_id.neq.y'})).rejects.toThrow('Invalid message cursor')
  })
  it('surfaces failed reads instead of returning an empty conversation', async () => {
    const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>({data:null,error:{message:'offline'}})}
    await expect(readMessageHistory({from:()=>query} as unknown as SupabaseClient,'matter-a')).rejects.toThrow('Could not load')
  })
})
