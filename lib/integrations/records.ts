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

interface PersistenceOptions {
  signal?: AbortSignal
}

interface ClaimExternalRecordOptions extends PersistenceOptions {
  /** Exact legacy placeholder identity that may be promoted before any attempt. */
  replaceUnattemptedPlaceholder?: { sourceVersion: string; idempotencyKey: string }
}

/**
 * Providers `integration_external_records` will actually accept.
 *
 * The table constrains `provider` in SQL, so a provider added to
 * IntegrationProvider for its error/reporting vocabulary alone would typecheck
 * here and then fail at the database. Mercury is exactly that case: it reuses
 * IntegrationError but persists nothing. Keep this set in step with the CHECK
 * constraint, and widen both together.
 */
const PERSISTABLE_PROVIDERS: ReadonlySet<IntegrationProvider> = new Set(['lawmatics', 'statular'])

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

/**
 * The gate every exported path passes through before touching the table, and
 * again after each await. It enforces two things: that the caller still holds
 * its claim, and that this provider is one the table will accept at all.
 */
function requirePersistable(ref: ExternalRecordRef, signal?: AbortSignal): void {
  if (!PERSISTABLE_PROVIDERS.has(ref.provider)) {
    throw recordError(ref, 'provider_not_persistable', 'This integration does not store external records.')
  }
  if (signal?.aborted) throw persistenceError(ref)
}

// Reads may use the worker signal, but mutations must not: aborting the local
// fetch cannot cancel an already accepted database transaction. Each mutation
// is fenced immediately before it starts, awaited to settlement, then fenced
// again so the worker retains its claim while a server write may still commit.

export async function getExternalRecord(ref: ExternalRecordRef, options: PersistenceOptions = {}): Promise<ExternalRecord | null> {
  requirePersistable(ref, options.signal)
  let query = admin().from('integration_external_records').select('*')
    .eq('provider', ref.provider).eq('internal_entity_type', ref.internalEntityType)
    .eq('internal_entity_id', ref.internalEntityId).eq('external_record_type', ref.externalRecordType)
  if (options.signal) query = query.abortSignal(options.signal)
  const { data, error } = await query.maybeSingle()
  requirePersistable(ref, options.signal)
  if (error) throw persistenceError(ref)
  return data
}

export async function claimExternalRecord(
  input: ClaimExternalRecordInput,
  options: ClaimExternalRecordOptions = {},
): Promise<ExternalRecord> {
  requirePersistable(input, options.signal)
  const patch = {
    ...identity(input), source_version: input.sourceVersion, idempotency_key: input.idempotencyKey,
    request_snapshot: input.requestSnapshot, request_hash: input.requestHash, status: 'pending',
    last_error_code: null, last_error_message: null,
  }
  // DO NOTHING on conflict: a concurrent worker may already have frozen or synced
  // this delivery. A normal merging upsert could erase that worker's snapshot.
  const insert = admin().from('integration_external_records')
    .upsert(patch, { onConflict: 'provider,internal_entity_type,internal_entity_id,external_record_type', ignoreDuplicates: true })
    .select('*')
  requirePersistable(input, options.signal)
  const { data: inserted, error } = await insert.maybeSingle()
  requirePersistable(input, options.signal)
  if (error) throw persistenceError(input)
  if (inserted) return inserted

  const existing = await getExternalRecord(input, options)
  requirePersistable(input, options.signal)
  if (!existing) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  if (existing.idempotency_key === input.idempotencyKey) {
    if (existing.request_hash !== input.requestHash) {
      const placeholder = options.replaceUnattemptedPlaceholder
      const replaceable = placeholder
        && existing.idempotency_key === placeholder.idempotencyKey
        && existing.source_version === placeholder.sourceVersion
        && existing.request_hash === null
        && existing.request_snapshot === null
        && existing.external_id === null
        && existing.last_attempt_at === null
        && (existing.status === 'attention' || existing.status === 'disabled')
      if (!replaceable) {
        throw recordError(input, 'idempotency_payload_conflict', 'The integration request changed under the same idempotency key.')
      }
      requirePersistable(input, options.signal)
      const promotion = admin().from('integration_external_records').update(patch)
        .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
        .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
        .eq('idempotency_key', placeholder.idempotencyKey).eq('source_version', placeholder.sourceVersion)
        .in('status', ['attention', 'disabled']).is('request_hash', null).is('request_snapshot', null)
        .is('external_id', null).is('last_attempt_at', null)
        .select('*')
      requirePersistable(input, options.signal)
      const { data, error: promotionError } = await promotion.maybeSingle()
      requirePersistable(input, options.signal)
      if (promotionError) throw persistenceError(input)
      if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
      return data
    }
    return existing
  }

  // Compare-and-swap the prior delivery identity. Never write external_id here:
  // it remains stable even if a concurrent success has just saved it.
  requirePersistable(input, options.signal)
  let update = admin().from('integration_external_records').update(patch)
    .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
    .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
    .eq('idempotency_key', existing.idempotency_key)
  update = existing.request_hash === null ? update.is('request_hash', null) : update.eq('request_hash', existing.request_hash)
  const selected = update.select('*')
  requirePersistable(input, options.signal)
  const { data, error: updateError } = await selected.maybeSingle()
  requirePersistable(input, options.signal)
  if (updateError) throw persistenceError(input)
  if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  return data
}

interface RecordAttempt extends ExternalRecordRef {
  idempotencyKey: string
  /** Optional compare-and-swap fence for callers that begin an exclusive attempt. */
  attemptAt?: string
}

async function beginAttempt(
  input: RecordAttempt & { expectedLastAttemptAt: string | null },
  createOnly: boolean,
  options: PersistenceOptions,
): Promise<ExternalRecord> {
  requirePersistable(input, options.signal)
  const previous = input.expectedLastAttemptAt === null ? 0 : Date.parse(input.expectedLastAttemptAt)
  const at = new Date(Math.max(Date.now(), previous + 1)).toISOString()
  // Consume prior retry eligibility in the same CAS that acquires the attempt.
  // A later reader must see an in-flight attempt, not its predecessor's rejection.
  let update = admin().from('integration_external_records').update({
    last_attempt_at: at, status: 'pending', last_error_code: null, last_error_message: null,
  })
    .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
    .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
    .eq('idempotency_key', input.idempotencyKey)
  update = input.expectedLastAttemptAt === null
    ? update.is('last_attempt_at', null) : update.eq('last_attempt_at', input.expectedLastAttemptAt)
  // Create-only callers must not reopen a record that completed after they
  // read their claim. Keep this in the same UPDATE as the timestamp CAS.
  if (createOnly) update = update.is('external_id', null).neq('status', 'synced')
  const selected = update.select('*')
  requirePersistable(input, options.signal)
  const { data, error } = await selected.maybeSingle()
  requirePersistable(input, options.signal)
  if (error) throw persistenceError(input)
  if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  return data
}

export function beginIntegrationAttempt(
  input: RecordAttempt & { expectedLastAttemptAt: string | null },
  options: PersistenceOptions = {},
): Promise<ExternalRecord> {
  return beginAttempt(input, false, options)
}

/** Acquire an exclusive create attempt without reopening a completed record. */
export function beginCreateIntegrationAttempt(
  input: RecordAttempt & { expectedLastAttemptAt: string | null },
  options: PersistenceOptions = {},
): Promise<ExternalRecord> {
  return beginAttempt(input, true, options)
}

async function updateAttempt(input: RecordAttempt, patch: RecordUpdate, options: PersistenceOptions): Promise<ExternalRecord> {
  requirePersistable(input, options.signal)
  let update = admin().from('integration_external_records').update(patch)
    .eq('provider', input.provider).eq('internal_entity_type', input.internalEntityType)
    .eq('internal_entity_id', input.internalEntityId).eq('external_record_type', input.externalRecordType)
    .eq('idempotency_key', input.idempotencyKey)
  if (input.attemptAt !== undefined) update = update.eq('last_attempt_at', input.attemptAt)
  // Concurrent attempts share an idempotency key. Check status in the UPDATE
  // itself so a late failure cannot downgrade a success committed by a peer.
  if (patch.status !== 'synced') update = update.neq('status', 'synced')
  const selected = update.select('*')
  requirePersistable(input, options.signal)
  const { data, error } = await selected.maybeSingle()
  requirePersistable(input, options.signal)
  if (error) throw persistenceError(input)
  if (!data) throw recordError(input, 'integration_record_changed', 'Integration record changed; retry the operation.', 'retryable')
  return data
}

export async function recordIntegrationSuccess(
  input: RecordAttempt & { externalId: string },
  options: PersistenceOptions = {},
): Promise<ExternalRecord> {
  if (typeof input.externalId !== 'string' || !input.externalId.trim()) throw new Error('External ID must be a non-empty string.')
  const at = new Date().toISOString()
  return updateAttempt(input, {
    external_id: input.externalId.trim(), status: 'synced', last_error_code: null, last_error_message: null,
    last_attempt_at: input.attemptAt ?? at, last_succeeded_at: at,
  }, options)
}

/** Complete a cancellation without manufacturing an external ID for an unsent record. */
export async function recordIntegrationCancellation(input: RecordAttempt, options: PersistenceOptions = {}): Promise<ExternalRecord> {
  const at = new Date().toISOString()
  return updateAttempt(input, {
    status: 'synced', last_error_code: null, last_error_message: null,
    last_attempt_at: input.attemptAt ?? at, last_succeeded_at: at, metadata: { operation: 'cancelled' },
  }, options)
}

/** Complete a conclusively unsent attempt without erasing its evidence. */
export async function recordIntegrationDisabled(input: RecordAttempt, options: PersistenceOptions = {}): Promise<ExternalRecord> {
  return updateAttempt(input, { status: 'disabled', last_error_code: null, last_error_message: null }, options)
}

export async function recordIntegrationFailure(
  input: RecordAttempt & { error: unknown },
  options: PersistenceOptions = {},
): Promise<ExternalRecord> {
  if (!(input.error instanceof IntegrationError)) throw new Error('Integration failure must be normalized.')
  if (input.error.provider !== input.provider) throw new Error('Integration failure provider does not match the record.')
  const safe = safeIntegrationError(input.error)
  return updateAttempt(input, {
    status: safe.kind === 'attention' ? 'attention' : 'pending', last_error_code: safe.code,
    last_error_message: safe.message, last_attempt_at: input.attemptAt ?? new Date().toISOString(),
  }, options)
}
