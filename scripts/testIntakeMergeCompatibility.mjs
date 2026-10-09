/** Local-only Postgres verification. Creates and drops its own isolated database. */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const container = process.argv[2] ?? 'supabase_db_aubrey-law-portal-clean'
const database = `codex_intake_merge_${process.pid}`
const args = db => ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At']
function sql(query, db = database) {
  return execFileSync('docker', args(db), { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
async function lockCheck(holder, contender) {
  const child = spawn('docker', args(database), { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''; let errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors)))
  })
  // Hold the transaction open using stdin, not a timing-dependent sleep.
  child.stdin.write(`BEGIN; ${holder}; SELECT 'LOCK_READY';\n`)
  try {
    for (let i = 0; !output.includes('LOCK_READY') && i < 100; i++) await delay(50)
    if (!output.includes('LOCK_READY')) throw new Error(`Lock holder failed: ${errors}`)
    let rejected = false
    try { sql(`SET lock_timeout='150ms'; ${contender};`) }
    catch (error) {
      if (!String(error.stderr).includes('lock timeout')) throw error
      rejected = true
    }
    if (!rejected) throw new Error('Concurrent mutation bypassed pinning lock')
  } finally {
    child.stdin.end('ROLLBACK;\n')
    await finished
  }
}
sql(`CREATE DATABASE ${database};`, 'postgres')
try {
  sql([
    'tests/sql/intake-merge-bootstrap.sql',
    'supabase/migrations/20270131090100_merge_matters.sql',
    'supabase/migrations/20270203090200_intake_merge_compatibility.sql',
    'tests/sql/intake-merge-compatibility.sql',
  ].map(path => readFileSync(path, 'utf8')).join('\n'))
  sql(`INSERT INTO public.client_intake(id) VALUES ('10000000-0000-0000-0000-000000000001');
    INSERT INTO public.matters(id,client_intake_id,status) VALUES
      ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active'),
      ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','active');`)
  const merge = `SET request.jwt.claim.role='service_role'; SELECT public.merge_matters('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')`
  await lockCheck(merge, `UPDATE public.client_intake SET intake_track='college_prep' WHERE id='10000000-0000-0000-0000-000000000001'`)
  await lockCheck(`UPDATE public.client_intake SET answers='{"changed":true}' WHERE id='10000000-0000-0000-0000-000000000001'`, merge)
  await lockCheck(merge, `UPDATE public.matters SET client_intake_id=NULL WHERE id='20000000-0000-0000-0000-000000000001'`)
  console.log('Merge compatibility SQL assertions and three concurrent lock checks passed.')
} finally {
  sql(`DROP DATABASE ${database};`, 'postgres')
}
