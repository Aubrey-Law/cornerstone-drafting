/** Local-only Postgres verification. Creates and drops its own isolated database. */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const container = process.argv[2] ?? 'supabase_db_aubrey-law-portal-clean'
const database = `codex_intake_pinning_${process.pid}`
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
  sql(`CREATE TABLE public.users(id uuid PRIMARY KEY, role text);
    CREATE TABLE public.client_intake(id text PRIMARY KEY, intake_track text NOT NULL DEFAULT 'estate', answers jsonb, practice_area text);
    ${readFileSync('supabase/migrations/20270130090001_intake_form_builder_foundation.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20270131090200_intake_form_builder_audit.sql', 'utf8')}
    ALTER TABLE public.intake_form_templates ADD COLUMN purpose text NOT NULL DEFAULT 'client_intake';
    ${readFileSync('supabase/migrations/20270203090000_intake_form_pinning_guards.sql', 'utf8')}
    ${readFileSync('tests/sql/intake-form-pinning.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20270203090100_intake_creation_track.sql', 'utf8')}
    ${readFileSync('tests/sql/intake-creation-track.sql', 'utf8')}`)
  const template = '20000000-0000-0000-0000-000000000001'
  const version = '30000000-0000-0000-0000-000000000001'
  const actor = '10000000-0000-0000-0000-000000000001'
  const insert = "INSERT INTO public.client_intake(id) VALUES ('concurrent')"
  await lockCheck(insert, `SELECT public.retire_intake_form_version('${actor}','${version}')`)
  await lockCheck(insert, `SELECT public.archive_intake_form_template('${actor}','${template}',true)`)
  await lockCheck(`SELECT public.retire_intake_form_version('${actor}','${version}')`, insert)
  await lockCheck(`SELECT public.archive_intake_form_template('${actor}','${template}',true)`, insert)
  await lockCheck(insert, `UPDATE public.intake_form_versions SET status='retired' WHERE id='${version}'`)
  await lockCheck(insert, `UPDATE intake_private.form_pinning_rollout SET enabled=false`)
  console.log('Creation-track and pinning SQL assertions plus six concurrent lock checks passed.')
} finally {
  sql(`DROP DATABASE ${database};`, 'postgres')
}
