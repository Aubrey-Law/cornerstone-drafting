import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const target = new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if (!['postgres:','postgresql:'].includes(target.protocol) || !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Local fixture required')
const viewer = randomUUID(), other = randomUUID(), prefix = `page-${randomUUID()}`
function sql(query: string) {
  return execFileSync('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',query], { encoding:'utf8', env:{ ...process.env, PGHOST:target.hostname, PGPORT:target.port, PGUSER:decodeURIComponent(target.username), PGPASSWORD:decodeURIComponent(target.password), PGDATABASE:target.pathname.slice(1) } }).trim()
}
type FixturePage = { rows: Array<{id:string;priority:string}>; total:number; scopeCounts:{mine:number;team:number;unassigned:number} }
function page(overrides: Record<string,unknown> = {}) {
  const query = { page:1, pageSize:50, viewerId:viewer, scope:'mine', source:'all', priority:'all', assignee:'all', status:'open', ...overrides }
  return JSON.parse(sql(`select public.firm_task_page_v1('${JSON.stringify(query)}'::jsonb)`)) as FixturePage
}
beforeAll(() => {
  sql(`insert into public.tasks(title,owner,status,priority,source,assignee_id,effective_due_at,created_at)
    select '${prefix}', 'firm','open',case when n%3=0 then 'high' else 'normal' end,'manual','${viewer}',
      case when n>550 then null else '2026-09-01T12:00:00Z'::timestamptz end,'2026-08-01T12:00:00Z'
    from generate_series(1,601) n`)
  sql(`insert into public.tasks(title,owner,status,priority,source,assignee_id,completed_at)
    values ('${prefix}','firm','done','normal','manual','${viewer}','2026-09-10T04:00:00Z'),
    ('${prefix}','firm','done','normal','manual','${viewer}','2026-09-11T03:59:59Z'),
    ('${prefix}','firm','done','normal','manual','${viewer}','2026-09-11T04:00:00Z'),
    ('${prefix}','client','open','high','manual','${viewer}',null),
    ('${prefix}','automation','open','high','manual','${viewer}',null),
    ('${prefix}','firm','open','normal','manual','${other}',null),
    ('${prefix}','firm','open','normal','manual',null,null)`)
})
afterAll(() => sql(`delete from public.tasks where title='${prefix}'`))
describe('complete task pages in Postgres', () => {
  it('counts beyond page 1, orders ties deterministically, and excludes other owners', () => {
    const first=page(), second=page({page:2})
    expect(first.total).toBe(601)
    expect(first.rows).toHaveLength(50)
    expect(first.scopeCounts).toEqual({ mine:601,team:1,unassigned:1 })
    expect(new Set([...first.rows,...second.rows].map(row=>row.id)).size).toBe(100)
    expect(page().rows.map(row=>row.id)).toEqual(first.rows.map(row=>row.id))
    expect(first.rows.every(row=>row.priority==='high')).toBe(true)
    expect(page({page:13}).rows).toHaveLength(1)
    expect(page({priority:'high'}).total).toBe(200)
    expect(page({scope:'unassigned'}).total).toBe(1)
  })
  it('selects completion dates in firm time before pagination', () => {
    const result=page({status:'done',completedOn:'2026-09-10'})
    expect(result.total).toBe(2)
    expect(result.rows).toHaveLength(2)
  })
  it('does not expose firm aggregates to portal clients', () => {
    expect(sql("select has_function_privilege('authenticated','public.firm_task_page_v1(jsonb)','EXECUTE')")).toBe('f')
    expect(sql("select has_function_privilege('authenticated','public.firm_lead_summary_v1()','EXECUTE')")).toBe('f')
  })
})
