/** Local-only Postgres verification. Creates and drops its own isolated database. */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const container = process.argv[2] ?? 'supabase_db_aubrey-law-portal-clean'
const database = `codex_intake_appointments_${process.pid}`
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
  sql(['tests/sql/intake-staff-appointments.sql', 'supabase/migrations/20270203090500_intake_staff_appointments.sql', 'tests/sql/intake-staff-appointment-assertions.sql'].map(path => readFileSync(path, 'utf8')).join('\n'))
  const change = `SELECT public.appointment_test_call('20000000-0000-0000-0000-000000000002')`
  await lockCheck(change, `UPDATE client_intake SET status='submitted' WHERE id='intake'`)
  await lockCheck(change, `INSERT INTO contact_roles(contact_id,matter_id,role,for_party,priority,is_coagent) VALUES('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','poa','client',1,false)`)
  await lockCheck(change, `DELETE FROM matter_contacts WHERE matter_id='30000000-0000-0000-0000-000000000001' AND contact_id='20000000-0000-0000-0000-000000000002'`)
  console.log('Appointment assertions, rollback, and three concurrent lock checks passed.')
} finally { sql(`DROP DATABASE ${database};`, 'postgres') }
