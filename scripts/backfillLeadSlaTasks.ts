/**
 * Backfill the v3 SLA plan onto opportunities that predate task generation.
 *
 * Leads created before the SLA was wired into lead creation have a `matters`
 * row but no `matter_tasks`, so their checklist is empty. This generates one
 * for each. Generation is idempotent — a matter that already has tasks is left
 * alone — so the script is safe to re-run.
 *
 * Almost every task lands undated, which is correct: the pre-engagement tasks
 * wait on the discovery call and the PMPS date, and the Day-0 tasks wait on the
 * engagement signature. Setting those anchors is what fills the dates in.
 *
 * Usage (reads the hosted credentials from the env files):
 *   set -a; source .env; source .env.local; set +a
 *   npx tsx scripts/backfillLeadSlaTasks.ts [--apply]
 *
 * Without --apply it reports what it would do and writes nothing.
 */
import { createClient } from '@supabase/supabase-js'
// Deliberately not importing lib/slaTasks/generate: it is marked `server-only`,
// which cannot resolve outside Next. The scheduling helpers it builds on are
// pure, so the script composes them directly.
import { buildMatterTaskInserts, parseTemplateTasks } from '../lib/slaTasks/schedule'
import { firmTodayKey } from '../lib/firmDate'

const ESTATE_PLANNING_SLA_V3 = 'estate_planning_sla_v3'

const APPLY = process.argv.includes('--apply')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: matters, error } = await admin
    .from('matters')
    .select('id, name, relationship_status, created_at')
    .in('relationship_status', ['lead', 'lost', 'declined'])
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const { data: withTasks, error: taskError } = await admin
    .from('matter_tasks')
    .select('matter_id')
  if (taskError) throw new Error(taskError.message)
  const already = new Set((withTasks ?? []).map(row => row.matter_id as string))

  const { data: template, error: templateError } = await admin
    .from('sla_task_templates')
    .select('id, tasks')
    .eq('template_name', ESTATE_PLANNING_SLA_V3)
    .maybeSingle()
  if (templateError) throw new Error(templateError.message)
  if (!template) throw new Error(`No SLA template named "${ESTATE_PLANNING_SLA_V3}"`)
  const templateTasks = parseTemplateTasks(template.tasks)

  const pending = (matters ?? []).filter(m => !already.has(m.id))
  console.log(
    `${matters?.length ?? 0} lead-side matters, ${pending.length} without a checklist` +
      (APPLY ? '' : ' (dry run — pass --apply to write)'),
  )

  let created = 0
  for (const matter of pending) {
    const label = `${matter.relationship_status.padEnd(8)} ${matter.name ?? matter.id}`
    if (!APPLY) {
      console.log(`  would generate  ${label}`)
      continue
    }
    const rows = buildMatterTaskInserts(templateTasks, {
      matterId: matter.id,
      templateId: template.id as string,
      startDate: firmTodayKey(),
      anchors: {
        discovery_call: null,
        pmps: null,
        engagement: null,
      },
    })
    const { error: insertError } = await admin.from('matter_tasks').insert(rows)
    if (insertError) {
      console.warn(`  FAILED          ${label} — ${insertError.message}`)
      continue
    }
    created += 1
    const dated = rows.filter(r => r.due_date).length
    console.log(`  generated ${String(rows.length).padStart(2)} tasks (${dated} dated)  ${label}`)
  }
  if (APPLY) console.log(`\nDone. ${created} checklists created.`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
