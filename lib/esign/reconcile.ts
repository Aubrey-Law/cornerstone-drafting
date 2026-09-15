import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { applyRecipientStates, completeWorkspaceAgreement } from '@/lib/esign/completion'
import type { EsignProvider } from '@/lib/esign/types'

/**
 * Catch up on agreements the provider never told us about.
 *
 * Webhooks are a delivery mechanism, not a guarantee: they get dropped,
 * mis-signed, delivered while a deploy is mid-flight, or retried past their
 * schedule. Without a sweep, a signed engagement can sit looking "sent"
 * indefinitely, and the post-engagement SLA clock never starts.
 *
 * Two deliberate limits:
 *
 * - It only *reads* from the provider. It never resends a notification or
 *   cancels a request, because a background job that emails clients on its own
 *   is how a reconciliation sweep turns into an incident.
 * - It writes only on an authoritative response. A failure to reach the
 *   provider is recorded as a sync error against the agreement, not treated as
 *   a state change.
 */

/** Agreements in flight — the only ones whose state can still move. */
const IN_FLIGHT_STATUSES = ['sending', 'sent', 'viewed', 'partially_signed'] as const

export const DEFAULT_STALE_MINUTES = 15
export const DEFAULT_BATCH_LIMIT = 25

export type ReconcileOutcome = {
  scanned: number
  updated: number
  completed: number
  failed: number
  unavailable?: string
}

type AgreementRow = {
  id: string
  matter_id: string | null
  status: string
  provider: string | null
  external_request_id: string | null
  firma_request_id: string | null
}

async function recordSyncFailure(
  admin: SupabaseClient,
  agreementId: string,
  message: string,
): Promise<void> {
  await admin
    .from('engagement_agreements')
    .update({
      provider_sync_error: message,
      provider_sync_error_at: new Date().toISOString(),
    })
    .eq('id', agreementId)
}

/**
 * Reconcile one agreement against authoritative provider state.
 * Returns whether anything changed, so the sweep can report usefully.
 */
export async function reconcileAgreement(
  admin: SupabaseClient,
  provider: EsignProvider,
  agreement: AgreementRow,
): Promise<{ changed: boolean; completed: boolean; failed: boolean }> {
  const requestId = agreement.external_request_id ?? agreement.firma_request_id
  if (!requestId) {
    // 'sending' with no request id means the send never got far enough to
    // create one. There is nothing to ask about; leave it for the send path.
    return { changed: false, completed: false, failed: false }
  }

  let state
  try {
    state = await provider.getEnvelopeState(requestId)
  } catch (e) {
    await recordSyncFailure(admin, agreement.id, e instanceof Error ? e.message : 'provider unreachable')
    return { changed: false, completed: false, failed: true }
  }

  const now = new Date().toISOString()
  await admin
    .from('engagement_agreements')
    .update({ last_provider_sync_at: now, provider_sync_error: null, provider_sync_error_at: null })
    .eq('id', agreement.id)

  await applyRecipientStates(admin, agreement.id, state.recipients ?? [])

  if (state.status === 'signed') {
    if (!agreement.matter_id) {
      await recordSyncFailure(admin, agreement.id, 'engagement agreement has no matter owner')
      return { changed: false, completed: false, failed: true }
    }
    const completed = await completeWorkspaceAgreement(admin, {
      agreementId: agreement.id,
      matterId: agreement.matter_id,
      state,
      provider: (agreement.provider as 'firma' | 'native' | null) ?? 'firma',
      externalRequestId: requestId,
    })
    if (!completed.ok) {
      // A retryable deferral (evidence still generating) is not an error worth
      // flagging to staff — the next sweep picks it up.
      if (!completed.retryable) await recordSyncFailure(admin, agreement.id, completed.error)
      return { changed: false, completed: false, failed: !completed.retryable }
    }
    return { changed: true, completed: true, failed: false }
  }

  if (state.status === 'declined') {
    const { error } = await admin
      .from('engagement_agreements')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', agreement.id)
      .neq('status', 'completed')
    if (error) throw new Error(error.message)
    return { changed: true, completed: false, failed: false }
  }

  if (['sent', 'viewed', 'partially_signed'].includes(state.status) && state.status !== agreement.status) {
    const { error } = await admin
      .from('engagement_agreements')
      .update({ status: state.status, updated_at: now })
      .eq('id', agreement.id)
      .neq('status', 'completed')
    if (error) throw new Error(error.message)
    return { changed: true, completed: false, failed: false }
  }

  return { changed: false, completed: false, failed: false }
}

/**
 * Sweep a bounded batch of stale in-flight agreements.
 *
 * The batch limit belongs here rather than at the caller so a cron
 * misconfiguration cannot turn one invocation into an unbounded provider
 * hammering.
 */
export async function reconcileStaleAgreements(input?: {
  staleMinutes?: number
  limit?: number
}): Promise<ReconcileOutcome> {
  const staleMinutes = Math.max(1, input?.staleMinutes ?? DEFAULT_STALE_MINUTES)
  const limit = Math.min(Math.max(1, input?.limit ?? DEFAULT_BATCH_LIMIT), 100)

  const resolved = resolveEsignProvider()
  if (!resolved.ok) {
    return { scanned: 0, updated: 0, completed: 0, failed: 0, unavailable: resolved.error }
  }

  const admin = getAdminClient()
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000).toISOString()

  // `last_provider_sync_at is null` covers agreements sent before this sweep
  // existed, which are exactly the ones most likely to be stuck.
  const { data, error } = await admin
    .from('engagement_agreements')
    .select('id, matter_id, status, provider, external_request_id, firma_request_id')
    .in('status', IN_FLIGHT_STATUSES as unknown as string[])
    .or(`last_provider_sync_at.is.null,last_provider_sync_at.lt.${staleBefore}`)
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as AgreementRow[]
  const outcome: ReconcileOutcome = { scanned: rows.length, updated: 0, completed: 0, failed: 0 }

  for (const row of rows) {
    try {
      const result = await reconcileAgreement(admin, resolved.provider, row)
      if (result.changed) outcome.updated += 1
      if (result.completed) outcome.completed += 1
      if (result.failed) outcome.failed += 1
    } catch (e) {
      // One bad agreement must not abort the sweep for the rest of the batch.
      console.error('[esign reconcile] agreement failed', row.id, e)
      outcome.failed += 1
    }
  }

  return outcome
}
