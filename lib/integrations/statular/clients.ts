import 'server-only'
import { createHash } from 'node:crypto'
import type { Json } from '@/types/supabase'
import { IntegrationError } from '@/lib/integrations/errors'
import {
  beginCreateIntegrationAttempt,
  claimExternalRecord,
  getExternalRecord,
  recordIntegrationFailure,
  recordIntegrationSuccess,
  type ExternalRecordRef,
} from '@/lib/integrations/records'
import type { IntegrationResult } from '@/lib/integrations/types'
import { createStatularClient } from './client'
import { getStatularConfig } from './config'
import { buildStatularClientPayload } from './clientPayload'
import type { StatularClientPayload } from './types'

function canonicalize(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  throw new Error('Statular snapshots must be JSON values.')
}

function snapshotHash(snapshot: Json): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function result(operation: IntegrationResult['operation'], externalId: string): IntegrationResult {
  return { provider: 'statular', externalRecordType: 'client', externalId, operation }
}

function safeFailure(error: unknown): IntegrationError {
  if (error instanceof IntegrationError && error.provider === 'statular') {
    // Reconstruct from the safe surface so an unexpected attached transport
    // cause can never escape this service or reach durable error state.
    return new IntegrationError({
      provider: error.provider, kind: error.kind, code: error.code,
      safeMessage: error.safeMessage, retryAfterMs: error.retryAfterMs,
    })
  }
  return new IntegrationError({
    provider: 'statular', kind: 'retryable', code: 'synchronization_failed',
    safeMessage: 'Statular client synchronization could not be completed.', retryAfterMs: null,
  })
}

/** Creates a Statular client once, with the database snapshot authoritative on retry. */
export async function syncStatularClient(clientIntakeId: string): Promise<IntegrationResult> {
  const ref: ExternalRecordRef = {
    provider: 'statular', internalEntityType: 'lead', internalEntityId: clientIntakeId, externalRecordType: 'client',
  }
  const existing = await getExternalRecord(ref)
  if (existing?.external_id) return result('reused', existing.external_id)

  const config = getStatularConfig()
  const payload = await buildStatularClientPayload(clientIntakeId)
  const requestSnapshot = canonicalize(payload)
  const requestHash = snapshotHash(requestSnapshot)
  const idempotencyKey = `cornerstone:statular:client:${clientIntakeId}:${config.generation}`
  const claimed = await claimExternalRecord({
    ...ref, sourceVersion: requestHash, idempotencyKey, requestSnapshot, requestHash,
  })
  if (claimed.external_id) return result('reused', claimed.external_id)

  let fenced
  try {
    fenced = await beginCreateIntegrationAttempt({
      ...ref, idempotencyKey: claimed.idempotency_key, expectedLastAttemptAt: claimed.last_attempt_at,
    })
  } catch (error) {
    if (error instanceof IntegrationError && error.code === 'integration_record_changed') {
      const completed = await getExternalRecord(ref)
      if (completed?.external_id) return result('reused', completed.external_id)
    }
    throw safeFailure(error)
  }
  const attempt = { ...ref, idempotencyKey: claimed.idempotency_key, attemptAt: fenced.last_attempt_at! }
  try {
    // The claimed snapshot, not the just-built object, is the replay contract.
    const storedPayload = claimed.request_snapshot as unknown as StatularClientPayload
    const created = await createStatularClient(storedPayload, claimed.idempotency_key)
    await recordIntegrationSuccess({ ...attempt, externalId: created.id })
    return result('created', created.id)
  } catch (error) {
    const safe = safeFailure(error)
    await recordIntegrationFailure({ ...attempt, error: safe })
    throw safe
  }
}
