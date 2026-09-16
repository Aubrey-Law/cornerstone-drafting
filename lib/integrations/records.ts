import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase, Json } from '@/types/supabase'
import { IntegrationError, safeIntegrationError } from './errors'
import type { IntegrationProvider, IntegrationResult } from './types'

/** Protected server-side row: never serialize this directly in an admin/portal response. */
export type ExternalRecord = GeneratedDatabase['public']['Tables']['integration_external_records']['Row']
type RecordUpdate = GeneratedDatabase['public']['Tables']['integration_external_records']['Update']

function admin(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

export interface ExternalRecordRef {
  provider: IntegrationProvider
  internalEntityType: 'lead' | 'matter' | 'appointment'
  internalEntityId: string
  externalRecordType: IntegrationResult['externalRecordType']
}

export interface ClaimExternalRecordInput extends ExternalRecordRef {
  sourceVersion: string
  idempotencyKey: string
  requestSnapshot: Json
  requestHash: string
}

function identity(ref: ExternalRecordRef) {
  return {
    provider: ref.provider,
    internal_entity_type: ref.internalEntityType,
    internal_entity_id: ref.internalEntityId,
    external_record_type: ref.externalRecordType,
  }
}

function recordError(ref: ExternalRecordRef, code: string, safeMessage: string, kind: 'attention' | 'retryable' = 'attention') {
  return new IntegrationError({ provider: ref.provider, kind, code, safeMessage, retryAfterMs: null })
}

function persistenceError(ref: ExternalRecordRef) {
  // Database detail can contain the protected snapshot; never attach it as a cause.
  return recordError(ref, 'integration_persistence_failed', 'Unable to persist or read integration record.', 'retryable')
}

export async function getExternalRecord(ref: ExternalRecordRef): Promise<ExternalRecord | null> {
  const { data, error } = await admin().from('integration_external_records').select('*')
    .eq('provider', ref.provider).eq('internal_entity_type', ref.internalEntityType)
    .eq('internal_entity_id', ref.internalEntityId).eq('external_record_type', ref.externalRecordType)
    .maybeSingle()
  if (error) throw persistenceError(ref)
  return data
}

export async function claimExternalRecord(input: ClaimExternalRecordInput): Promise<ExternalRecord> {
  const patch = {
    ...identity(input), source_version: input.sourceVersion, idempotency_key: input.idempotencyKey,
    request_snapshot: input.requestSnapshot, request_hash: input.requestHash, status: 'pending',
    last_error_code: null, last_error_message: null,
  }
  // DO NOTHING on conflict: a concurrent worker may already have frozen or synced
  // this delivery. A normal merging upsert could erase that worker's snapshot.
  const { data: inserted, error } = await admin().from('integration_external_records')
    .upsert(patch, { onConflict: 'provider,internal_entity_type,internal_entity_id,external_record_type', ignoreDuplicates: true })
    .select('*').maybeSingle()
  if (error) throw persistenceError(input)
  if (inserted) return inserted

  const existing = await getExternalRecord(input)
  if (!existing) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  if (existing.idempotency_key === input.idempotencyKey) {
    if (existing.request_hash !== input.requestHash) {
      throw recordError(input, 'idempotency_payload_conflict', 'The integration request changed under the same idempotency key.')
    }
    return existing
  }

  // Compare-and-swap the prior delivery identity. Never write external_id here:
  // it remains stable even if a concurrent success has just saved it.
  let update = admin().from('integration_external_records').update(patch)
    .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
    .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
    .eq('idempotency_key', existing.idempotency_key)
  update = existing.request_hash === null ? update.is('request_hash', null) : update.eq('request_hash', existing.request_hash)
  const { data, error: updateError } = await update.select('*').maybeSingle()
  if (updateError) throw persistenceError(input)
  if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  return data
}

interface RecordAttempt extends ExternalRecordRef {
  idempotencyKey: string
}

async function updateAttempt(input: RecordAttempt, patch: RecordUpdate): Promise<ExternalRecord> {
  const { data, error } = await admin().from('integration_external_records').update(patch)
    .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
    .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
    .eq('idempotency_key', input.idempotencyKey).select('*').maybeSingle()
  if (error) throw persistenceError(input)
  if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  return data
}

export async function recordIntegrationSuccess(input: RecordAttempt & { externalId: string }): Promise<ExternalRecord> {
  if (typeof input.externalId !== 'string' || !input.externalId.trim()) throw new Error('External ID must be a non-empty string.')
  const at = new Date().toISOString()
  return updateAttempt(input, {
    external_id: input.externalId.trim(), status: 'synced', last_error_code: null, last_error_message: null,
    last_attempt_at: at, last_succeeded_at: at,
  })
}

export async function recordIntegrationFailure(input: RecordAttempt & { error: unknown }): Promise<ExternalRecord> {
  if (!(input.error instanceof IntegrationError)) throw new Error('Integration failure must be normalized.')
  if (input.error.provider !== input.provider) throw new Error('Integration failure provider does not match the record.')
  const safe = safeIntegrationError(input.error)
  return updateAttempt(input, {
    status: safe.kind === 'attention' ? 'attention' : 'pending', last_error_code: safe.code,
    last_error_message: safe.message, last_attempt_at: new Date().toISOString(),
  })
}
