import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { enqueueWorkflowJob } from '@/lib/workflowJobs'
import { IntegrationError } from '@/lib/integrations/errors'
import { getExternalRecord, type ExternalRecord, type ExternalRecordRef } from '@/lib/integrations/records'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { syncStatularClient } from './clients'
import { getStatularConfig } from './config'

function failure(kind: 'attention' | 'retryable', code: string, safeMessage: string) {
  return new IntegrationError({ provider: 'statular', kind, code, safeMessage, retryAfterMs: null })
}

function persistenceFailure() {
  return failure('retryable', 'integration_persistence_failed', 'Unable to persist or read integration record.')
}

function enqueueFailure() {
  return failure('retryable', 'enqueue_failed', 'Unable to enqueue Statular client synchronization.')
}

function normalizedFailure(error: unknown) {
  if (error instanceof IntegrationError && error.provider === 'statular') {
    return new IntegrationError({
      provider: 'statular', kind: error.kind, code: error.code,
      safeMessage: error.safeMessage, retryAfterMs: error.retryAfterMs,
    })
  }
  return failure('retryable', 'synchronization_failed', 'Statular client synchronization could not be completed.')
}

function requireActive(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw failure('retryable', 'timeout', 'The Statular request timed out or was cancelled.')
  }
}

const PREFLIGHT_SOURCE_VERSION = 'statular-client-preflight:v1'

function preflightIdempotencyKey(clientIntakeId: string) {
  // This grammar is disjoint from every real client key, which always starts
  // `cornerstone:statular:client:<uuid>:` regardless of provider generation.
  return `cornerstone:statular:preflight-client:${clientIntakeId}:v1`
}

function isVerifiedPreflight(record: ExternalRecord): boolean {
  return record.source_version === PREFLIGHT_SOURCE_VERSION
    && record.idempotency_key === preflightIdempotencyKey(record.internal_entity_id)
    && record.request_hash === null
    && record.request_snapshot === null
    && record.external_id === null
    && record.last_attempt_at === null
    && (record.status === 'attention' || record.status === 'disabled')
}

/**
 * Resolve only explicit appointment links. Email matching is deliberately not
 * repeated here: linkage has already been committed by the booking flow.
 */
export async function enqueueStatularClientForAppointment(appointmentId: string): Promise<unknown> {
  try {
    if (!(await getIntegrationSettings()).statularSyncEnabled) return
    const admin = getAdminClient()
    const { data: appointment, error } = await admin.from('appointments')
      .select('id, source, linked_lead_id, linked_matter_id')
      .eq('id', appointmentId).maybeSingle()
    if (error || !appointment) throw enqueueFailure()
    if (appointment.source === 'calendly') return

    const leadId = appointment.linked_lead_id
    let matterClientIntakeId: string | null = null
    if (appointment.linked_matter_id) {
      const { data: matter, error: matterError } = await admin.from('matters')
        .select('client_intake_id').eq('id', appointment.linked_matter_id).maybeSingle()
      if (matterError || !matter) throw enqueueFailure()
      matterClientIntakeId = matter.client_intake_id
    }
    // Conflicting committed identities are not safe to guess through.
    if (leadId && matterClientIntakeId && leadId !== matterClientIntakeId) return
    const clientIntakeId = leadId ?? matterClientIntakeId
    if (!clientIntakeId) return

    const { generation } = getStatularConfig()
    return await enqueueWorkflowJob({
      type: 'statular_create_client',
      dedupeKey: `statular-client:${clientIntakeId}:${generation}`,
      payload: { clientIntakeId },
    })
  } catch {
    // Never retain provider URLs, PII, database detail, or attached causes.
    throw enqueueFailure()
  }
}

/** Persist a queue preflight outcome without manufacturing provider-attempt evidence. */
async function recordNonAttemptState(
  ref: ExternalRecordRef,
  before: ExternalRecord | null,
  status: 'attention' | 'disabled',
  reason?: IntegrationError,
  signal?: AbortSignal,
) {
  requireActive(signal)
  const admin = getAdminClient()
  const patch = {
    status,
    last_error_code: reason?.code ?? null,
    last_error_message: reason?.safeMessage ?? null,
  }
  if (!before) {
    let insert = admin.from('integration_external_records').upsert({
      provider: ref.provider,
      internal_entity_type: ref.internalEntityType,
      internal_entity_id: ref.internalEntityId,
      external_record_type: ref.externalRecordType,
      source_version: PREFLIGHT_SOURCE_VERSION,
      idempotency_key: preflightIdempotencyKey(ref.internalEntityId),
      request_snapshot: null,
      request_hash: null,
      ...patch,
    }, {
      onConflict: 'provider,internal_entity_type,internal_entity_id,external_record_type',
      ignoreDuplicates: true,
    }).select('*')
    if (signal) insert = insert.abortSignal(signal)
    const { error } = await insert.maybeSingle()
    requireActive(signal)
    if (error) throw persistenceFailure()
    return
  }

  // Never downgrade evidence from an active/provider attempt or a terminal
  // human-review/success state. An unattempted disabled placeholder may still
  // become attention after configuration or source validation runs.
  if (before.status === 'synced' || before.status === 'attention' || !isVerifiedPreflight(before)) return
  let update = admin.from('integration_external_records').update(patch)
    .eq('provider', ref.provider)
    .eq('internal_entity_type', ref.internalEntityType)
    .eq('internal_entity_id', ref.internalEntityId)
    .eq('external_record_type', ref.externalRecordType)
    .eq('idempotency_key', before.idempotency_key)
    .eq('source_version', PREFLIGHT_SOURCE_VERSION)
    .eq('status', before.status)
    .is('request_hash', null)
    .is('request_snapshot', null)
    .is('external_id', null)
    .is('last_attempt_at', null)
    .select('*')
  if (signal) update = update.abortSignal(signal)
  const { error } = await update.maybeSingle()
  requireActive(signal)
  if (error) throw persistenceFailure()
}

export async function runStatularClientSyncJob(clientIntakeId: string, signal?: AbortSignal): Promise<void> {
  const ref: ExternalRecordRef = {
    provider: 'statular', internalEntityType: 'lead', internalEntityId: clientIntakeId,
    externalRecordType: 'client',
  }
  try {
    requireActive(signal)
    const settings = await getIntegrationSettings()
    requireActive(signal)
    const before = await getExternalRecord(ref, { signal })
    requireActive(signal)
    if (!settings.statularSyncEnabled) {
      await recordNonAttemptState(ref, before, 'disabled', undefined, signal)
      return
    }
    try {
      getStatularConfig()
    } catch (error) {
      requireActive(signal)
      const safe = normalizedFailure(error)
      if (safe.kind === 'retryable') throw safe
      await recordNonAttemptState(ref, before, 'attention', safe, signal)
      return
    }
    requireActive(signal)
    try {
      await syncStatularClient(clientIntakeId, signal)
    } catch (error) {
      requireActive(signal)
      const safe = normalizedFailure(error)
      if (safe.kind === 'retryable') throw safe
      await recordNonAttemptState(ref, before, 'attention', safe, signal)
    }
  } catch (error) {
    requireActive(signal)
    throw normalizedFailure(error)
  }
}
