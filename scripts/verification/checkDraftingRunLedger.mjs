// Run only against a disposable, unexposed local PostgreSQL Docker container:
// node scripts/verification/checkDraftingRunLedger.mjs <container-name>
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const container = process.argv[2]
if (!container || !/^[a-zA-Z0-9_-]+$/.test(container)) throw new Error('Supply a disposable PostgreSQL Docker container name')
const database = `draft_run_test_${process.pid}`
function sql(input, db = database) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
const matter = '10000000-0000-4000-8000-000000000001'
const run = '20000000-0000-4000-8000-000000000001'
const actor = '30000000-0000-4000-8000-000000000001'
const token = '40000000-0000-4000-8000-000000000001'
const replacement = '40000000-0000-4000-8000-000000000002'
const claim = (id = run, worker = token, hash = 'hash') => `public.claim_draft_generation_run('${id}','${matter}','${actor}','revision','${hash}',array['trust.docx','will.docx'],'${worker}')`
const insert = (worker = token, name = 'Trust.docx', output = 'trust.docx') => `insert into matter_documents(matter_id,generation_id,name,r2_key) values('${matter}','${run}','${name}','matters/${matter}/draft-runs/${run}/${worker}/${output}')`
sql(`create database ${database}`, 'postgres')
try {
  sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
    alter role service_role bypassrls;
    create table matters(id uuid primary key);
    create table matter_documents(id uuid primary key default gen_random_uuid(), matter_id text, generation_id uuid, name text, r2_key text, created_at timestamptz default now(), reviewed_at timestamptz, superseded_at timestamptz);
    grant usage on schema public to service_role; grant all on matters,matter_documents to service_role;
    insert into matters values('${matter}');`)
  const migration = readFileSync(new URL('../../supabase/migrations/20260911191300_drafting_runs.sql', import.meta.url), 'utf8')
  sql(migration); sql(migration)
  assert.equal(sql(`set role service_role; select ${claim()}->>'worker_token'`).split('\n').at(-1), token)
  assert.equal(sql(`select ${claim(run, replacement)}->>'worker_token'`), token, 'Live replay must not acquire ownership')
  sql(`do $$ begin begin perform ${claim(run, replacement, 'wrong')}; raise exception 'accepted wrong hash'; exception when raise_exception then if sqlerrm='accepted wrong hash' then raise; end if; end; end $$`)
  sql(insert())
  sql(`update matter_documents set name='Renamed Trust.docx'`)
  sql(`do $$ begin begin ${insert()}; raise exception 'duplicate accepted'; exception when unique_violation then null; end; end $$`)
  sql(`update draft_generation_runs set status='partial',outcomes='[{"filename":"trust.docx","name":"Renamed Trust.docx","status":"saved"}]' where id='${run}'`)
  assert.equal(sql(`select ${claim(run, replacement)}->>'worker_token'`), replacement)
  assert.equal(sql(`select jsonb_array_length(outcomes) from draft_generation_runs where id='${run}'`), '1', 'Resume retains successful outputs')
  sql(`do $$ begin begin ${insert(token, 'Will.docx', 'will.docx')}; raise exception 'old worker accepted'; exception when raise_exception then if sqlerrm='old worker accepted' then raise; end if; end; end $$`)
  sql(insert(replacement, 'Will.docx', 'will.docx'))
  sql(`update draft_generation_runs set lease_expires_at=now()-interval '1 second' where id='${run}'`)
  sql(`do $$ begin begin ${insert(replacement, 'Other.docx', 'other.docx')}; raise exception 'expired worker accepted'; exception when raise_exception then if sqlerrm='expired worker accepted' then raise; end if; end; end $$`)
  assert.equal(sql(`select has_table_privilege('anon','draft_generation_runs','SELECT') or has_table_privilege('authenticated','draft_generation_runs','SELECT')`), 'f')
  assert.equal(sql(`select has_function_privilege('authenticated','public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid)','EXECUTE')`), 'f')
  sql(`insert into matter_documents(matter_id,name,r2_key) values('${matter}','Legacy.docx','matters/${matter}/draft/legacy.docx')`)
  // Simultaneous claims for the same request must return the same owner.
  const concurrentId = '20000000-0000-4000-8000-000000000002'
  const asyncSql = input => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'])
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { error += chunk })
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)))
    child.stdin.end(input)
  })
  const owners = await Promise.all([asyncSql(`select ${claim(concurrentId, token)}->>'worker_token'`), asyncSql(`select ${claim(concurrentId, replacement)}->>'worker_token'`)])
  assert.equal(owners[0], owners[1], 'Concurrent claim must have one owner')
  assert.equal(JSON.parse(sql(`select public.draft_generation_metrics('${matter}')`)).runs, 2)
  console.log('PASS: migration replay, service access, RLS, request replay, hash validation, immutable output uniqueness after rename, partial resume, old/expired worker fencing, legacy output, concurrent claim')
} finally {
  sql(`drop database ${database} with (force)`, 'postgres')
}
