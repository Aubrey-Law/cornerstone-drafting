/** Local-only Postgres verification. Creates and drops its own isolated database. */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const container = process.argv[2] ?? 'supabase_db_aubrey-law-portal-clean'
const database = `codex_intake_membership_${process.pid}`
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
    'tests/sql/intake-staff-contact-edit.sql',
    'supabase/migrations/20270203090300_intake_staff_contact_edit.sql',
    'tests/sql/intake-staff-contact-assertions.sql',
    'supabase/migrations/20270203090400_intake_staff_contact_membership.sql',
    'tests/sql/intake-staff-membership-bootstrap.sql',
    'tests/sql/intake-staff-membership-assertions.sql',
  ].map(path => readFileSync(path, 'utf8')).join('\n'))
  const remove = `SELECT public.membership_test_call('remove','20000000-0000-0000-0000-000000000004','{}',(select to_jsonb(c)-array['id','client_intake_id','source','merged_into_id','metadata','relationship_type','relationship_label'] from contacts c where id='20000000-0000-0000-0000-000000000004'))`
  const add = `SELECT public.membership_test_call('add','20000000-0000-0000-0000-000000000005','{"first_name":"Next","last_name":"Person"}')`
  await lockCheck(remove, `INSERT INTO contact_roles(contact_id,role) VALUES('20000000-0000-0000-0000-000000000004','hcp')`)
  await lockCheck(add, `UPDATE matters SET client_intake_id='other' WHERE id='30000000-0000-0000-0000-000000000001'`)
  await lockCheck(add, `UPDATE client_intake SET status='submitted' WHERE id='intake'`)
  await lockCheck(add, `SELECT public.membership_test_call('add','20000000-0000-0000-0000-000000000007','{"first_name":"Next","last_name":"Person"}')`)
  console.log('Contact membership assertions, rollback, and four concurrent lock checks passed.')
} finally {
  sql(`DROP DATABASE ${database};`, 'postgres')
}
