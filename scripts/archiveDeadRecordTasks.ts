/**
 * One-time sweep: archive the open tasks left behind on records that are done.
 *
 * From 20261006000000 onwards a matter that closes, or a lead that goes lost or
 * declined, archives its own open tasks on the way out. Everything that died
 * before that still has its full checklist sitting in the firm queue. This
 * clears the backlog, using the same helper the live paths use so the two can
 * never disagree about what "archived by closeout" means.
 *
 * Nothing is deleted, completed tasks are untouched, and every row it archives
 * carries `closeout_reason` — so reopening the matter, or moving the lead back
 * to Lead, puts exactly these tasks back.
 *
 * Usage (reads the hosted credentials from the env files):
 *   set -a; source .env; source .env.local; set +a
 *   npx tsx scripts/archiveDeadRecordTasks.ts [--apply]
 *
 * Without --apply it reports what it would archive and writes nothing.
 */
import { createClient } from '@supabase/supabase-js'
import { archiveTasksForClosedRecord, type CloseoutReason } from '../lib/tasks/closeout'

/** Statuses that represent work still outstanding. Mirrors lib/tasks/closeout. */
const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

/** Matter statuses that mean the engagement is over. */
const DEAD_MATTER_STATUSES = ['closed', 'archived']

/** Relationship statuses that mean the person never became a client. */
const DEAD_RELATIONSHIP_STATUSES = ['lost', 'declined']

const APPLY = process.argv.includes('--apply')

interface DeadRecord {
  matterId: string
  leadId: string | null
  label: string
  reason: CloseoutReason
  openTasks: number
}

/**
 * Relationship status wins over work status. A lead that was marked lost has
 * `status = 'active'` on its matter row — it never had work to close — so
 * reading the work axis first would miss the entire lead backlog.
 */
function reasonFor(relationship: string | null, status: string | null): CloseoutReason | null {
  if (relationship === 'lost') return 'lead_lost'
  if (relationship === 'declined') return 'lead_declined'
  if (status && DEAD_MATTER_STATUSES.includes(status)) return 'matter_closed'
  return null
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: matters, error } = await admin
    .from('matters')
    .select('id, name, status, relationship_status')
    .or(
      `status.in.(${DEAD_MATTER_STATUSES.join(',')}),` +
        `relationship_status.in.(${DEAD_RELATIONSHIP_STATUSES.join(',')})`,
    )
  if (error) throw new Error(error.message)

  const matterIds = (matters ?? []).map(m => m.id as string)
  if (matterIds.length === 0) {
    console.log('No closed matters or dead leads.')
    return
  }

  // A lead's hand-added tasks carry `lead_id`, not `matter_id`, so the sweep
  // needs the intake id behind each matter as well as the matter itself.
  const { data: intakes, error: intakeError } = await admin
    .from('client_intake')
    .select('id, matter_id')
    .in('matter_id', matterIds)
  if (intakeError) throw new Error(intakeError.message)
  const leadByMatter = new Map<string, string>()
  for (const row of intakes ?? []) {
    if (row.matter_id) leadByMatter.set(row.matter_id as string, row.id as string)
  }

  // One pass for the counts rather than a query per record: the whole point of
  // a dry run is to be cheap enough to run before the real thing. Paged,
  // because PostgREST caps a single response and a silent truncation here
  // would under-report the very backlog the run is meant to measure.
  const openTasks: Array<{ matter_id: string | null; lead_id: string | null }> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error: taskError } = await admin
      .from('tasks')
      .select('matter_id, lead_id')
      .in('status', OPEN_STATUSES)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (taskError) throw new Error(taskError.message)
    const page = (data ?? []) as Array<{ matter_id: string | null; lead_id: string | null }>
    openTasks.push(...page)
    if (page.length < PAGE) break
  }

  const byMatter = new Map<string, number>()
  const byLead = new Map<string, number>()
  for (const task of openTasks) {
    const { matter_id: matterId, lead_id: leadId } = task
    if (matterId) byMatter.set(matterId, (byMatter.get(matterId) ?? 0) + 1)
    // Counted under the lead only when it is not already counted under the
    // matter, so a task carrying both is not double-reported.
    else if (leadId) byLead.set(leadId, (byLead.get(leadId) ?? 0) + 1)
  }

  const records: DeadRecord[] = []
  for (const matter of matters ?? []) {
    const reason = reasonFor(
      matter.relationship_status as string | null,
      matter.status as string | null,
    )
    if (!reason) continue
    const matterId = matter.id as string
    const leadId = leadByMatter.get(matterId) ?? null
    const openCount = (byMatter.get(matterId) ?? 0) + (leadId ? byLead.get(leadId) ?? 0 : 0)
    if (openCount === 0) continue
    records.push({
      matterId,
      leadId,
      label: (matter.name as string | null) ?? matterId,
      reason,
      openTasks: openCount,
    })
  }

  const total = records.reduce((sum, record) => sum + record.openTasks, 0)
  console.log(
    `${matterIds.length} dead records, ${records.length} still holding ${total} open tasks` +
      (APPLY ? '' : ' (dry run — pass --apply to write)'),
  )

  let archived = 0
  for (const record of records.sort((a, b) => b.openTasks - a.openTasks)) {
    const line = `${String(record.openTasks).padStart(3)}  ${record.reason.padEnd(14)} ${record.label}`
    if (!APPLY) {
      console.log(`  would archive ${line}`)
      continue
    }
    const count = await archiveTasksForClosedRecord(
      admin,
      { matterId: record.matterId, leadId: record.leadId },
      record.reason,
      {},
      { logActivity: false },
    )
    if (count === null) {
      console.warn(`  FAILED        ${line}`)
      continue
    }
    archived += count
    console.log(`  archived ${String(count).padStart(3)}  ${record.reason.padEnd(14)} ${record.label}`)
  }
  if (APPLY) console.log(`\nDone. ${archived} tasks archived.`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
