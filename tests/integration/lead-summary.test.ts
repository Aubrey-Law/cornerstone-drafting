import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
const target=new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if(!['postgres:','postgresql:'].includes(target.protocol)||!['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Local fixture required')
function sql(query:string) { return execFileSync('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',env:{...process.env,PGHOST:target.hostname,PGPORT:target.port,PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:target.pathname.slice(1)}}).trim() }
describe('global lead summary',()=>{
  it('aggregates beyond the REST row cap and retains intentionally global semantics',()=>{
    const prefix=randomUUID()
    try {
      sql(`insert into public.lead_fixture(id,lead_status,is_open,needs_attention,has_pending_agreement,awaiting_intake,engagement_fee_quoted) select md5('${prefix}'||n)::uuid,case when n=1502 then 'lost' when n=1503 then 'declined' else 'lead' end,n<=1200,n<=3,n<=7,n<=9,100 from generate_series(1,1503) n`)
      expect(JSON.parse(sql('select public.firm_lead_summary_v1()'))).toEqual({all:1503,open:1501,lost:1,declined:1,attention:3,agreements:7,awaitingIntake:9,quotedPipeline:120000})
    } finally {sql(`delete from public.lead_fixture where id in (select md5('${prefix}'||n)::uuid from generate_series(1,1503) n)`)}
  })
})
