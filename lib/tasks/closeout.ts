import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Sweeping a dead record's tasks out of the queue.
 *
 * A matter that closes and a lead that goes lost or declined both leave a full
 * checklist behind — plan rows, stage tasks, hand-added to-dos — and every one
 * of them keeps showing up in the firm queue for work nobody will ever do. The
 * sweep archives what is still open at the moment the record dies.
 *
 * Two things it deliberately does not do:
 *
 *  - Delete. The tasks are the record of what the firm planned and did; a
 *    closed matter's history is worth more than the row count it costs.
 *  - Touch completed tasks. `done` stays `done`, so the plan still reads as
 *    "these ten were finished, these six were dropped when it closed".
 *
 * Reversible in both directions: `closeout_reason` marks the rows this sweep
 * archived, so reopening the record restores exactly those and leaves a task
 * the user skipped by hand alone.
 */

/** Statuses that represent work still outstanding. Mirrors OPEN_STATUSES. */
const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

export const CLOSEOUT_REASONS = ['matter_closed', 'lead_lost', 'lead_declined'] as const

export type CloseoutReason = (typeof CLOSEOUT_REASONS)[number]

/** Which record the sweep runs against. A lead has both; a matter has one. */
export interface CloseoutTarget {
  matterId?: string | null
  leadId?: string | null
}

export interface CloseoutActor {
  id?: string | null
  email?: string | null
  name?: string | null
}

export interface CloseoutOptions {
  /**
   * Write a timeline entry for the sweep. On by default, and off for the
   * one-time backfill: stamping today's date onto matters that closed months
   * ago would say something untrue about when the tasks were dropped.
   */
  logActivity?: boolean
}

const REASON_LABEL: Record<CloseoutReason, string> = {
  matter_closed: 'the matter closed',
  lead_lost: 'the lead was marked lost',
  lead_declined: 'the lead was declined',
}

/**
 * A lead's tasks hang off two columns: the plan is generated against the
 * lead's `matters` row, while hand-added lead tasks carry `lead_id`. Both are
 * the same record to the user, so the sweep matches either — the same `or`
 * filter the task queries use for `recordId`.
 */
function recordFilter(target: CloseoutTarget): string[] {
  const clauses: string[] = []
  if (target.matterId) clauses.push(`matter_id.eq.${target.matterId}`)
  if (target.leadId) clauses.push(`lead_id.eq.${target.leadId}`)
  return clauses
}

/**
 * Archive every open task on the record. Returns how many were archived, or
 * null if the write failed — the caller has already committed the status
 * change, so a failed sweep is reported, never thrown.
 */
export async function archiveTasksForClosedRecord(
  admin: SupabaseClient,
  target: CloseoutTarget,
  reason: CloseoutReason,
  actor: CloseoutActor = {},
  options: CloseoutOptions = {},
): Promise<number | null> {
  const clauses = recordFilter(target)
  if (clauses.length === 0) return 0

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tasks')
    .update({
      status: 'archived',
      // The same stamp the "skipped — not applicable" action sets, because to
      // every plan reader that is what these rows now are: dropped, not done.
      skipped_at: now,
      closeout_reason: reason,
      updated_at: now,
    })
    .in('status', OPEN_STATUSES)
    .or(clauses.join(','))
    .select('id')

  if (error) {
    console.error('archiveTasksForClosedRecord:', error.message)
    return null
  }

  const count = data?.length ?? 0
  if (count > 0 && options.logActivity !== false) {
    await logCloseout(admin, target, reason, count, actor)
  }
  return count
}

/**
 * Put back what the sweep took. Only rows it marked are restored, and they come
 * back as `open` — a task that was `in_progress` or `blocked` when the record
 * died needs re-triage anyway, and collapsing to one status keeps this from
 * needing a second column to remember the old one.
 */
export async function restoreTasksForReopenedRecord(
  admin: SupabaseClient,
  target: CloseoutTarget,
  actor: CloseoutActor = {},
  options: CloseoutOptions = {},
): Promise<number | null> {
  const clauses = recordFilter(target)
  if (clauses.length === 0) return 0

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('tasks')
    .update({
      status: 'open',
      skipped_at: null,
      closeout_reason: null,
      updated_at: now,
    })
    .not('closeout_reason', 'is', null)
    .or(clauses.join(','))
    .select('id')

  if (error) {
    console.error('restoreTasksForReopenedRecord:', error.message)
    return null
  }

  const count = data?.length ?? 0
  if (count > 0 && options.logActivity !== false) {
    await logRestore(admin, target, count, actor)
  }
  return count
}

function plural(count: number): string {
  return count === 1 ? '1 task' : `${count} tasks`
}

/** Best effort — a missing timeline entry must not fail the status change. */
async function logCloseout(
  admin: SupabaseClient,
  target: CloseoutTarget,
  reason: CloseoutReason,
  count: number,
  actor: CloseoutActor,
): Promise<void> {
  const title = `${plural(count)} archived`
  const detail = `Open tasks were archived because ${REASON_LABEL[reason]}.`
  await writeActivity(admin, target, title, detail, { reason, count }, actor)
}

async function logRestore(
  admin: SupabaseClient,
  target: CloseoutTarget,
  count: number,
  actor: CloseoutActor,
): Promise<void> {
  const title = `${plural(count)} restored`
  const detail = 'Tasks archived when the record was closed are open again.'
  await writeActivity(admin, target, title, detail, { count }, actor)
}

async function writeActivity(
  admin: SupabaseClient,
  target: CloseoutTarget,
  title: string,
  detail: string,
  metadata: Record<string, unknown>,
  actor: CloseoutActor,
): Promise<void> {
  try {
    // A lead owns a `matters` row too, but its timeline is `lead_activity` —
    // that is the feed the lead page renders, so it wins when both exist.
    if (target.leadId) {
      await admin.from('lead_activity').insert({
        lead_id: target.leadId,
        event_type: 'status_changed',
        title,
        detail,
        actor_id: actor.id ?? null,
      })
    } else if (target.matterId) {
      await admin.from('matter_activity').insert({
        matter_id: target.matterId,
        event_type: 'status_changed',
        title,
        detail,
        metadata,
        actor_id: actor.id ?? null,
        actor_email: actor.email ?? null,
        actor_name: actor.name ?? actor.email ?? null,
      })
    }
  } catch (error) {
    console.warn('task closeout activity skipped:', error)
  }
}
