/**
 * Backfill the v3 SLA plan onto opportunities that predate task generation.
 *
 * Leads created before the SLA was wired into lead creation have a `matters`
 * row but no plan tasks, so their checklist is empty. This generates one for
 * each. Generation is idempotent — a matter that already has plan tasks is left
 * alone — so the script is safe to re-run.
 *
 * Almost every task lands undated, which is correct: the pre-engagement tasks
 * wait on the discovery call and the PMPS date, and the Day-0 tasks wait on the
 * engagement signature. Setting those anchors is what fills the dates in.
 *
 * Usage (reads the hosted credentials from .env.local, which is where
 * OPERATIONS_RUNBOOK.md and AGENTS.md put SUPABASE_SERVICE_ROLE_KEY):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/backfillLeadSlaTasks.ts [--apply]
 *
 * Loaded through dotenv rather than `set -a; source ...`, because a fresh
 * checkout has no `.env` to source: the shell reports that failure first, and
 * the real question — whether the key is in .env.local at all — arrives second.
 *
 * Without --apply it reports what it would do and writes nothing.
 */
import { createClient } from '@supabase/supabase-js'
// Deliberately not importing lib/slaTasks/generate: it is marked `server-only`,
// which cannot resolve outside Next. The scheduling helpers it builds on are
// pure, so the script composes them directly.
import { buildPlanTaskDrafts, parseTemplateTasks, type PlanTaskDraft } from '../lib/slaTasks/schedule'
import { firmTodayKey } from '../lib/firmDate'

/** A plan day is stored at 12:00Z — see lib/slaTasks/plan.ts. */
function planTimestamp(dateKey: string | null): string | null {
  return dateKey ? `${dateKey}T12:00:00.000Z` : null
}

/** The draft, as the columns `public.tasks` stores. Mirrors planTaskInsert. */
function taskRow(draft: PlanTaskDraft): Record<string, unknown> {
  const due = planTimestamp(draft.due_date)
  return {
    matter_id: draft.matter_id,
    source: 'sla',
    status: 'open',
    priority: 'normal',
    task_type: 'single',
    title: draft.name,
    phase: draft.phase,
    owner: draft.owner,
    plan_template_id: draft.plan_template_id,
    sort_order: draft.sort_order,
    skill: draft.skill,
    plan_start_date: draft.start_date,
    due_at: due,
    hard_due_at: due,
    nudge_at: planTimestamp(draft.nudge_date),
    nudge_tier: draft.nudge_tier,
    escalation_at: planTimestamp(draft.escalation_date),
    escalation_tier: draft.escalation_tier,
    due_offset_days: draft.due_offset_days,
    nudge_offset_days: draft.nudge_offset_days,
    escalation_offset_days: draft.escalation_offset_days,
    relative_to: draft.relative_to,
    pre_engagement: draft.pre_engagement,
    auto: draft.auto,
    conditional: draft.conditional,
    pauses_clock: draft.pauses_clock,
    gate: draft.gate,
    variant: draft.variant,
    extends_target_days: draft.extends_target_days,
    recurring_interval_days: draft.recurring_interval_days,
    triggers_day_zero: draft.triggers_day_zero,
  }
}

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
    .from('tasks')
    .select('matter_id')
    .eq('source', 'sla')
  if (taskError) throw new Error(taskError.message)
  const already = new Set(
    (withTasks ?? []).map(row => row.matter_id as string | null).filter((id): id is string => !!id),
  )

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
    const drafts = buildPlanTaskDrafts(templateTasks, {
      matterId: matter.id,
      templateId: template.id as string,
      startDate: firmTodayKey(),
      anchors: {
        discovery_call: null,
        pmps: null,
        engagement: null,
      },
    })
    const { error: insertError } = await admin.from('tasks').insert(drafts.map(taskRow))
    if (insertError) {
      console.warn(`  FAILED          ${label} — ${insertError.message}`)
      continue
    }
    created += 1
    const dated = drafts.filter(draft => draft.due_date).length
    console.log(`  generated ${String(drafts.length).padStart(2)} tasks (${dated} dated)  ${label}`)
  }
  if (APPLY) console.log(`\nDone. ${created} checklists created.`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
