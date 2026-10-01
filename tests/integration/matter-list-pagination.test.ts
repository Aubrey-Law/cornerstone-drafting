import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
const target=new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if(!['postgres:','postgresql:'].includes(target.protocol)||!['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Local fixture required')
const prefix=randomUUID()
function sql(query:string) { return execFileSync('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',env:{...process.env,PGHOST:target.hostname,PGPORT:target.port,PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:target.pathname.slice(1)}}).trim() }
const ids=`select md5('${prefix}'||n)::uuid from generate_series(1,153) n`
type MatterPage={rows:Array<{matter_id:string;stage:string;unreviewed_upload_count:number}>;total:number;page:number;groups:Record<string,number>;columns:Record<string,number>;insights:{attention:number;unreviewed:number}}
function page(overrides:Record<string,unknown>={}):MatterPage { return JSON.parse(sql(`select public.firm_matter_page_v1('${JSON.stringify({page:1,pageSize:50,sort:'newest',stage:'all',practice:'all',card:'',search:'',view:'table',...overrides})}'::jsonb)`)) }
beforeAll(()=>{
  sql(`insert into public.matters(id,matter_number,relationship_status) select md5('${prefix}'||n)::uuid,'${prefix}-'||n,case when n=153 then 'lead' else 'hired' end from generate_series(1,153) n`)
  sql(`insert into public.matter_fixture(matter_id,matter_name,client_name,stage,status,practice_area,matter_created) select md5('${prefix}'||n)::uuid,'Synthetic matter','Same client',case when n<=70 then 'intake' when n<=120 then 'drafting' when n<=150 then 'client_review' else 'closed' end,case when n=152 then 'archived' else 'open' end,case when n%2=0 then 'Probate' else 'EP' end,now() from generate_series(1,153) n`)
  sql(`insert into public.client_intake(id,uploads_reviewed_at) values (md5('${prefix}1')::uuid,'2026-09-01'); update public.matters set client_intake_id=id,portal_uploads_reviewed_at='2026-09-01' where id=md5('${prefix}1')::uuid;
    insert into public.intake_documents(client_intake_id,created_at) values (md5('${prefix}1')::uuid,'2026-08-01'),(md5('${prefix}1')::uuid,'2026-09-02');
    insert into public.matter_documents(matter_id,source,created_at) values ((md5('${prefix}1')::uuid)::text,'client','2026-09-02')`)
})
afterAll(()=>{
  sql(`delete from public.intake_documents where client_intake_id in (${ids}); delete from public.matter_documents where matter_id in (select id::text from (${ids}) as fixture(id)); delete from public.client_intake where id in (${ids}); delete from public.matter_fixture where matter_id in (${ids}); delete from public.matters where id in (${ids})`)
})
describe('complete matter pages and board columns',()=>{
  it('retains hired/open scope and stable global totals beyond 100 matters',()=>{
    const first=page(), second=page({page:2})
    // 153 rows, less the lead, the archived one, and the two left at the closed
    // stage: finished work is off the list until someone asks for it.
    expect(first.total).toBe(150)
    expect(first.rows).toHaveLength(50)
    expect(new Set([...first.rows,...second.rows].map(row=>row.matter_id)).size).toBe(100)
    expect(page().rows.map(row=>row.matter_id)).toEqual(first.rows.map(row=>row.matter_id))
    expect(first.groups).toEqual({early:70,active:50,work:30})
    expect(page({page:99}).page).toBe(3)
  })
  it('brings closed and archived matters back only when asked',()=>{
    const shown=page({closed:'show'})
    expect(shown.total).toBe(152)
    expect(shown.groups.closed).toBe(2)
  })
  it('pages each board column independently while retaining full column totals',()=>{
    const result=page({view:'board',groupPages:{early:2}})
    expect(result.rows.filter(row=>row.stage==='intake')).toHaveLength(20)
    expect(result.rows.filter(row=>row.stage==='drafting')).toHaveLength(50)
    expect(result.columns.early).toBe(70)
    // Not a second number: `total` counts the filtered set, and the view
    // changes only which of those rows come back. Same 150 as the table
    // view above. This said 151 — the default before
    // 20261128000000_hide_closed_matters.sql took the closed stage out of
    // the default list, which updated every other total in this file.
    expect(result.total).toBe(150)
  })
  it('filters the complete set and counts only uploads after review',()=>{
    expect(page({search:`${prefix}-150`}).total).toBe(1)
    // Search does not smuggle a closed matter back in; the toggle does.
    expect(page({search:`${prefix}-151`}).total).toBe(0)
    expect(page({search:`${prefix}-151`,closed:'show'}).total).toBe(1)
    expect(page({practice:'Probate'}).total).toBe(75)
    const attentionId=sql(`select md5('${prefix}1')::uuid`)
    expect(page({card:'attention'}).total).toBe(0)
    const attention=page({card:'attention',attentionIds:[attentionId]})
    expect(attention.total).toBe(1)
    expect(attention.rows[0].unreviewed_upload_count).toBe(2)
    expect(attention.insights.unreviewed).toBe(2)
    expect(sql("select has_function_privilege('authenticated','public.firm_matter_page_v1(jsonb)','EXECUTE')")).toBe('f')
  })
})
