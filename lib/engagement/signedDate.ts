import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { firmDateKey } from '@/lib/firmDate'
import { applySlaAnchor } from '@/lib/slaTasks/generate'
import { engagementPatchForSignedAt } from '@/lib/engagementStatus'

/**
 * When the engagement was signed is recorded in three places: the status
 * columns on `matter_details`, the lead's copy on `client_intake`, and the SLA
 * clock on `matters`. They are one fact, so every write path that touches the
 * date goes through here — the Dates panel, the SLA tab's key dates, and
 * anything else that learns the date later.
 */

/**
 * The Leads pipeline keeps its own copy of the engagement columns, so a
 * matter-side edit that skipped the mirror would leave the two boards
 * disagreeing about the same agreement.
 */
export async function mirrorEngagementToLead(
  admin: SupabaseClient,
  matterId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { data: matterRow } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()
  if (!matterRow?.client_intake_id) return null
  const { error } = await admin
    .from('client_intake')
    .update(patch)
    .eq('id', matterRow.client_intake_id)
  return error?.message ?? null
}

/**
 * The `matter_details` side: the date, the legacy signed flag and the status
 * move together, then the lead gets the same picture.
 */
export async function syncEngagementSignedDetails(
  admin: SupabaseClient,
  matterId: string,
  signedAt: string | null,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data: existing } = await admin
    .from('matter_details')
    .select('engagement_status, engagement_sent_at')
    .eq('client_id', matterId)
    .maybeSingle()

  const patch = engagementPatchForSignedAt(signedAt, existing)
  const { data: row, error } = await admin
    .from('matter_details')
    .upsert({ client_id: matterId, ...patch }, { onConflict: 'client_id' })
    .select()
    .single()
  if (error) {
    console.error('engagement signed date: matter_details write failed', { matterId, error })
    return { row: null, error: error.message }
  }

  const leadError = await mirrorEngagementToLead(admin, matterId, {
    engagement_status: patch.engagement_status,
    engagement_signed_at: patch.engagement_signed_at,
  })
  return { row: row ?? null, error: leadError }
}

/**
 * The plan checklist item that the signed date completes.
 *
 * Matched by title because the row carries no template key: `template_id` and
 * `stage_key` are null on all 32 of them (measured 2026-09-10). The string is
 * seeded in the SLA templates rather than defined here, so
 * `tests/engagement-signed-date-sync.test.ts` asserts both seeds still contain
 * it — a rename there would otherwise leave this silently matching nothing.
 *
 * `phase` alone will not do. `engagement_sent` also covers "Send engagement
 * agreement" and "Send recommendations + engagement agreement", which are the
 * firm's work and are not finished by the client signing.
 */
export const ENGAGEMENT_SIGNED_TASK_TITLE = 'Client signs engagement agreement'

/**
 * Tick the checklist item, because the fact that finishes it has just been
 * recorded.
 *
 * Measured 2026-09-10: of 24 hired matters with a signed date, four still had
 * this task open, and no unsigned matter did. So it is ticked by hand and the
 * hand sometimes misses — which is the kind of drift a derived field should
 * not need a person for.
 *
 * Only rows that are `open` are touched, so running twice changes nothing and
 * a task somebody already completed keeps its own timestamp.
 *
 * `completed_at` is the signed date, not now(): the item was finished when the
 * client signed, and a date recorded a fortnight late should not claim the
 * work happened a fortnight late.
 *
 * Clearing the date deliberately does NOT reopen the task. Nothing on the row
 * records that this function closed it, so reopening would also resurrect an
 * item an attorney had ticked by hand — undoing their work to undo ours.
 */
async function completeEngagementSignedTask(
  admin: SupabaseClient,
  matterId: string,
  signedAt: string,
): Promise<number> {
  const { data, error } = await admin
    .from('tasks')
    .update({ status: 'done', completed_at: signedAt })
    .eq('matter_id', matterId)
    .eq('source', 'sla')
    .eq('title', ENGAGEMENT_SIGNED_TASK_TITLE)
    .eq('status', 'open')
    .select('id')
  if (error) {
    // The date is what the attorney asked to record. A checklist tick that
    // could not be written is worth a log, not throwing the save away — the
    // same judgement the reschedule below makes.
    console.warn('engagement signed date: checklist tick skipped', matterId, error.message)
    return 0
  }
  return data?.length ?? 0
}

/**
 * The `matters` side: the anchor column, plus the tasks whose offsets hang off
 * that clock. Rescheduling reads the firm-timezone calendar day — a stamp near
 * midnight UTC belongs to the day the firm was working, not the UTC one.
 *
 * Clearing the date reschedules nothing: there is no day to schedule against,
 * so the tasks keep the dates they already have until a real date arrives.
 */
export async function syncEngagementSignedAnchor(
  admin: SupabaseClient,
  matterId: string,
  signedAt: string | null,
): Promise<{ rescheduled: number; completed: number; error: string | null }> {
  const { error } = await admin
    .from('matters')
    .update({ engagement_signed_at: signedAt })
    .eq('id', matterId)
  if (error) {
    console.error('engagement signed date: matters anchor write failed', { matterId, error })
    return { rescheduled: 0, completed: 0, error: error.message }
  }

  const dateKey = signedAt ? firmDateKey(signedAt) : null
  if (!dateKey) return { rescheduled: 0, completed: 0, error: null }

  const completed = await completeEngagementSignedTask(admin, matterId, signedAt as string)

  // The date is the thing the attorney asked to record. A reschedule that
  // cannot run is worth a log, not throwing the save away.
  const result = await applySlaAnchor(admin, matterId, 'engagement', dateKey)
  if (!result.ok) {
    console.warn('engagement signed date: reschedule skipped', matterId, result.error)
    return { rescheduled: 0, completed, error: null }
  }
  return { rescheduled: result.updated, completed, error: null }
}
