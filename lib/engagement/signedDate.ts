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
): Promise<{ rescheduled: number; error: string | null }> {
  const { error } = await admin
    .from('matters')
    .update({ engagement_signed_at: signedAt })
    .eq('id', matterId)
  if (error) {
    console.error('engagement signed date: matters anchor write failed', { matterId, error })
    return { rescheduled: 0, error: error.message }
  }

  const dateKey = signedAt ? firmDateKey(signedAt) : null
  if (!dateKey) return { rescheduled: 0, error: null }

  // The date is the thing the attorney asked to record. A reschedule that
  // cannot run is worth a log, not throwing the save away.
  const result = await applySlaAnchor(admin, matterId, 'engagement', dateKey)
  if (!result.ok) {
    console.warn('engagement signed date: reschedule skipped', matterId, result.error)
    return { rescheduled: 0, error: null }
  }
  return { rescheduled: result.updated, error: null }
}
