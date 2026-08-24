/**
 * One-time sweep: hold back the post-engagement plan on leads that already have
 * one.
 *
 * From 20261017000000 onwards `ensureLeadSlaTasks` generates the whole template
 * and immediately archives the post-engagement half behind
 * `closeout_reason = 'not_engaged'`, so a lead carries only the work that can
 * actually be done before an engagement is signed. Every lead created before
 * that is still carrying all 48 tasks. Measured on 2026-08-24: 39 lead matters
 * held 1,021 of the firm's 1,024 open tasks, 709 of them post-engagement, and
 * 24 leads were carrying post-execution work for a plan nobody had bought.
 *
 * This clears that backlog through the same helper the live path uses, so the
 * two can never disagree about what the hold-back means.
 *
 * Nothing is deleted and nothing pre-engagement is touched. Every row carries
 * `not_engaged`, so converting the lead — or running the reopen path — restores
 * exactly these and leaves a hand-skipped task skipped. Hand-added tasks carry
 * no phase and are never matched.
 *
 * Usage (reads the hosted credentials from .env.local, which is where
 * OPERATIONS_RUNBOOK.md and AGENTS.md put SUPABASE_SERVICE_ROLE_KEY):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/holdBackUnsoldLeadTasks.ts [--apply]
 *
 * Loaded through dotenv rather than `set -a; source ...`, because a fresh
 * checkout has no `.env` to source: the shell reports that failure first, and
 * the real question — whether the key is in .env.local at all — arrives second.
 *
 * Without --apply it reports what it would archive and writes nothing.
 */
import { createClient } from '@supabase/supabase-js'
import { archiveTasksForClosedRecord } from '../lib/tasks/closeout'
import { POST_ENGAGEMENT_PHASES } from '../lib/slaTasks/types'

/** Statuses that represent work still outstanding. Mirrors lib/tasks/closeout. */
const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

const APPLY = process.argv.includes('--apply')

interface LeadMatter {
  matterId: string
  label: string
  stage: string | null
  heldBack: number
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    // Names .env.local, the way OPERATIONS_RUNBOOK.md does. The old message
    // said to source `.env` too, which does not exist in a fresh checkout — so
    // it answered a question nobody asked and buried the one that matters.
    throw new Error(
      `${name} is not set. It lives in .env.local — run this as `
      + `DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/holdBackUnsoldLeadTasks.ts`,
    )
  }
  return value
}

async function main() {
  const admin = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )

  const { data: matters, error } = await admin
    .from('matters')
    .select('id, name, stage, client_intake_id')
    .eq('status', 'active')
    .eq('relationship_status', 'lead')
  if (error) throw new Error(`lead matters: ${error.message}`)

  const rows: LeadMatter[] = []
  for (const matter of (matters ?? []) as Array<{ id: string; name: string | null; stage: string | null }>) {
    // Counted per matter rather than in one grouped read: the count and the
    // sweep then ask the same question of the same row set, and a dry run
    // reports exactly what --apply would touch.
    const { count, error: countError } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('matter_id', matter.id)
      .in('status', OPEN_STATUSES)
      .in('phase', POST_ENGAGEMENT_PHASES)
    if (countError) throw new Error(`counting ${matter.id}: ${countError.message}`)
    if ((count ?? 0) === 0) continue
    rows.push({
      matterId: matter.id,
      label: matter.name ?? matter.id,
      stage: matter.stage,
      heldBack: count ?? 0,
    })
  }

  rows.sort((left, right) => right.heldBack - left.heldBack)
  const total = rows.reduce((sum, row) => sum + row.heldBack, 0)

  for (const row of rows) {
    console.log(`${String(row.heldBack).padStart(4)}  ${row.stage ?? '—'}  ${row.label}`)
    if (!APPLY) continue
    const archived = await archiveTasksForClosedRecord(
      admin,
      { matterId: row.matterId },
      'not_engaged',
      {},
      // No timeline entry: stamping today onto a lead created months ago would
      // say something untrue about when its plan was held back. Same reasoning
      // as scripts/archiveDeadRecordTasks.ts.
      { phases: POST_ENGAGEMENT_PHASES, logActivity: false },
    )
    if (archived === null) console.error(`  failed: ${row.matterId}`)
  }

  console.log(
    `\n${rows.length} lead${rows.length === 1 ? '' : 's'}, ${total} post-engagement task${total === 1 ? '' : 's'}` +
      (APPLY ? ' held back.' : ' would be held back (dry run — pass --apply to write).'),
  )
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
