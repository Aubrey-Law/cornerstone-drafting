import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'

const target = new URL(process.env.INTEGRATION_DATABASE_URL ?? '')
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Explicit local Postgres fixture required')
const prefix = `lease-test-${randomUUID()}`
function sql(query: string): string {
  return execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8', env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port,
      PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: target.pathname.slice(1) },
  }).trim()
}
function add(suffix: string, attempts = 0, max = 5) {
  return sql(`insert into public.workflow_jobs(job_type,dedupe_key,attempts,max_attempts) values ('prepare_invoice_reminders','${prefix}-${suffix}',${attempts},${max}) returning id` ).split('\n')[0]
}
function claim(worker: string) {
  const output = sql(`select row_to_json(j) from public.claim_workflow_jobs_v2(1,'${worker}',120) j`)
  return output ? JSON.parse(output) : null
}
afterAll(() => { sql(`delete from public.workflow_jobs where dedupe_key like '${prefix}%'`) })
describe('workflow lease recovery', () => {
  it('skips a row locked by another connection without waiting', async () => {
    const firstId = add('concurrent-a')
    const secondId = add('concurrent-b')
    const connection = spawn('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port,
        PGUSER: decodeURIComponent(target.username), PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: target.pathname.slice(1) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    try {
      const locked = new Promise<void>((resolve, reject) => {
        let output = ''
        connection.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('LOCK_READY')) resolve() })
        connection.once('error', reject)
        connection.once('exit', code => reject(new Error(`Lock connection exited: ${code}`)))
      })
      connection.stdin.write(`begin; select id from public.claim_workflow_jobs_v2(1,'parallel-a',120); select 'LOCK_READY';\n`)
      await locked
      const second = claim('parallel-b')
      expect(second.id).toBe(secondId)
      expect(sql(`select public.finish_workflow_job_v2('${secondId}','${second.claim_token}',null)`)).toBe('t')
      connection.stdin.end('commit;\n')
      await new Promise<void>((resolve, reject) => connection.once('exit', code => code === 0 ? resolve() : reject(new Error(`Commit failed: ${code}`))))
      expect(sql(`select locked_by from public.workflow_jobs where id='${firstId}'`)).toBe('parallel-a')
      sql(`delete from public.workflow_jobs where id='${firstId}'`)
    } finally { connection.kill() }
  })
  it('protects a live claim, replaces an expired claim, and rejects late completion', () => {
    const id = add('reclaim')
    const first = claim('worker-a')
    expect(first.id).toBe(id)
    expect(claim('worker-b')).toBeNull()
    sql(`update public.workflow_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${id}'`)
    const second = claim('worker-b')
    expect(second.id).toBe(id)
    expect(second.claim_token).not.toBe(first.claim_token)
    expect(second.attempts).toBe(2)
    expect(sql(`select public.finish_workflow_job_v2('${id}','${first.claim_token}',null)`)).toBe('f')
    expect(sql(`select status from public.workflow_jobs where id='${id}'`)).toBe('running')
    expect(sql(`select public.finish_workflow_job_v2('${id}','${second.claim_token}',null)`)).toBe('t')
    expect(sql(`select public.finish_workflow_job_v2('${id}','${second.claim_token}',null)`)).toBe('f')
  })
  it('fails exhausted jobs and backs off a retry after errors', () => {
    const exhausted = add('exhausted', 5)
    const pending = add('retry')
    const active = claim('worker-c')
    expect(active.id).toBe(pending)
    expect(sql(`select status from public.workflow_jobs where id='${exhausted}'`)).toBe('failed')
    expect(sql(`select public.finish_workflow_job_v2('${pending}','${active.claim_token}','synthetic failure')`)).toBe('t')
    expect(claim('worker-d')).toBeNull()
    expect(sql(`select available_at > clock_timestamp() from public.workflow_jobs where id='${pending}'`)).toBe('t')
  })
  it('does not grant clients permission to claim jobs', () => {
    expect(sql(`select has_function_privilege('authenticated','public.claim_workflow_jobs_v2(integer,text,integer)','EXECUTE')`)).toBe('f')
    expect(sql(`select has_function_privilege('service_role','public.claim_workflow_jobs_v2(integer,text,integer)','EXECUTE')`)).toBe('t')
  })
})
