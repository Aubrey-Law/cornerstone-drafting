import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'
import { IntegrationError } from '@/lib/integrations/errors'
import {
  beginIntegrationAttempt, claimExternalRecord, getExternalRecord,
  recordIntegrationDisabled, recordIntegrationFailure, recordIntegrationSuccess,
  type ExternalRecord, type ExternalRecordRef,
} from '@/lib/integrations/records'
import { createLawmaticsProspect } from './client'
import { externalSourceLabel, isExternallyManagedSource } from '@/lib/appointments/types'

export function lawmaticsDatabase(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

export function lawmaticsFailure(code: string, safeMessage: string, kind: 'attention' | 'retryable' = 'attention'): IntegrationError {
  return new IntegrationError({ provider: 'lawmatics', kind, code, safeMessage, retryAfterMs: null })
}

export function sourceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function loadLawmaticsAppointment(appointmentId: string) {
  const { data, error } = await lawmaticsDatabase().from('appointments')
    .select('id, source, status, appointment_type_id, start_time, end_time, location_type, linked_lead_id, linked_matter_id')
    .eq('id', appointmentId).maybeSingle()
  if (error) throw lawmaticsFailure('source_unavailable', 'The appointment could not be read.', 'retryable')
  if (!data) throw lawmaticsFailure('appointment_not_found', 'The appointment could not be found.')
  if (isExternallyManagedSource(data.source)) throw lawmaticsFailure('unsupported_source', `${externalSourceLabel(data.source)} appointments are not supported by Lawmatics synchronization.`)
  return data
}

function unknownCreate(): IntegrationError {
  return lawmaticsFailure('create_outcome_unknown', 'A Lawmatics create may already have succeeded. Review the provider record before retrying.')
}

// These failures conclusively reject a request before a new provider record exists.
const REJECTED_CREATES = new Set(['rate_limited', 'authentication_required', 'connection_unavailable',
  'permission_denied', 'not_found', 'validation_failed', 'request_rejected', 'invalid_request', 'integration_disabled'])

export function requireLawmaticsActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw lawmaticsFailure('timeout', 'The Lawmatics request timed out.', 'retryable')
}

export async function requireSafeCreate(record: ExternalRecord | null, ref: ExternalRecordRef,
  exclusiveEntityLease = false): Promise<void> {
  if (record && !record.external_id && record.last_attempt_at && record.status !== 'synced' && record.status !== 'disabled'
    && !REJECTED_CREATES.has(record.last_error_code ?? '')) {
    // Match the fixed entity lease: 120 seconds exceeds the 30-second HTTP
    // timeout and 50-second worker budget plus bounded cancellation cleanup.
    // Recent contention can recover automatically; stale ambiguity never POSTs.
    const age = Date.now() - Date.parse(record.last_attempt_at)
    if (!exclusiveEntityLease && record.status === 'pending' && !record.last_error_code && age >= -1000 && age < 120_000) {
      throw lawmaticsFailure('integration_busy', 'Lawmatics record creation is already running.', 'retryable')
    }
    const error = unknownCreate()
    if (record.status !== 'attention') {
      await recordIntegrationFailure({ ...ref, idempotencyKey: record.idempotency_key,
        attemptAt: record.last_attempt_at, error })
    }
    throw error
  }
}

export function isCompletedLawmaticsCancellation(record: ExternalRecord | null): boolean {
  const snapshot = record?.request_snapshot
  return record?.status === 'synced' && !!snapshot && typeof snapshot === 'object'
    && !Array.isArray(snapshot) && snapshot.status === 'cancelled'
}

/** Persist the attempt before POST; a lost response must never authorize another POST. */
export async function createAndRecordLawmatics(
  ref: ExternalRecordRef,
  claimed: ExternalRecord,
  create: () => Promise<{ id: string }>,
  previous: ExternalRecord | null = null,
  signal?: AbortSignal,
): Promise<string> {
  requireLawmaticsActive(signal)
  if (claimed.external_id) return claimed.external_id
  // A new source version clears failure/disabled state. Carry unsent evidence
  // forward only if the attempt timestamp still matches; a newer POST consumes it.
  const previousSafe = previous?.last_attempt_at === claimed.last_attempt_at
    && (REJECTED_CREATES.has(previous?.last_error_code ?? '')
      || previous?.status === 'disabled'
      || (!previous?.external_id && isCompletedLawmaticsCancellation(previous)))
  if (!previousSafe) await requireSafeCreate(claimed, ref)
  const fenced = await beginIntegrationAttempt({ ...ref, idempotencyKey: claimed.idempotency_key,
    expectedLastAttemptAt: claimed.last_attempt_at })
  const attempt = { ...ref, idempotencyKey: claimed.idempotency_key, attemptAt: fenced.last_attempt_at! }
  try {
    requireLawmaticsActive(signal)
    const result = await create()
    requireLawmaticsActive(signal)
    await recordIntegrationSuccess({ ...attempt, externalId: result.id })
    return result.id
  } catch (error) {
    if (ref.externalRecordType === 'event' && error instanceof IntegrationError && error.code === 'integration_disabled') {
      await recordIntegrationDisabled(attempt)
      throw error
    }
    const safe = error instanceof IntegrationError && REJECTED_CREATES.has(error.code) ? error : unknownCreate()
    // A persistence outage leaves the pre-POST fence intact, preventing duplicate creation.
    await recordIntegrationFailure({ ...attempt, error: safe })
    throw safe
  }
}

export function resolveLawmaticsProspect(appointmentId: string, options?: { readOnly?: false; signal?: AbortSignal }): Promise<string>
export function resolveLawmaticsProspect(appointmentId: string, options: { readOnly: true }): Promise<string | null>
export async function resolveLawmaticsProspect(appointmentId: string, options?: { readOnly?: boolean; signal?: AbortSignal }): Promise<string | null> {
  requireLawmaticsActive(options?.signal)
  const appointment = await loadLawmaticsAppointment(appointmentId)
  let intakeId = appointment.linked_lead_id
  if (appointment.linked_matter_id) {
    const { data: matter, error } = await lawmaticsDatabase().from('matters').select('client_intake_id')
      .eq('id', appointment.linked_matter_id).maybeSingle()
    if (error) throw lawmaticsFailure('source_unavailable', 'The linked matter could not be read.', 'retryable')
    if (!matter?.client_intake_id) throw lawmaticsFailure('identity_required', 'Link the appointment to a client intake before synchronization.')
    if (intakeId && intakeId !== matter.client_intake_id) throw lawmaticsFailure('identity_conflict', 'The linked lead and matter refer to different client intakes.')
    intakeId = matter.client_intake_id
  }
  if (!intakeId) throw lawmaticsFailure('identity_required', 'Link the appointment to a client intake before synchronization.')

  const ref: ExternalRecordRef = { provider: 'lawmatics', internalEntityType: 'lead', internalEntityId: intakeId, externalRecordType: 'prospect' }
  const existing = await getExternalRecord(ref)
  if (existing?.external_id) return existing.external_id
  if (!options?.readOnly) await requireSafeCreate(existing, ref)

  // The primary key linkage, never email similarity, verifies legacy import provenance.
  const { data: intake, error } = await lawmaticsDatabase().from('client_intake')
    .select('id, first_name, last_name, email, phone, lawmatics_matter_id').eq('id', intakeId).maybeSingle()
  if (error) throw lawmaticsFailure('source_unavailable', 'The linked client intake could not be read.', 'retryable')
  if (!intake) throw lawmaticsFailure('identity_required', 'The linked client intake could not be found.')
  const legacyId = intake.lawmatics_matter_id?.trim()
  // Reconciliation only observes verified identity; the worker owns claims and POSTs.
  if (options?.readOnly) return legacyId || null
  const firstName = intake.first_name?.trim()
  const lastName = intake.last_name?.trim()
  if (!legacyId && (!firstName || !lastName)) throw lawmaticsFailure('identity_required', 'The linked client intake needs explicit first and last names.')
  const input = { firstName: firstName ?? '', lastName: lastName ?? '',
    ...(intake.email ? { email: intake.email } : {}), ...(intake.phone ? { phone: intake.phone } : {}) }
  const snapshot = legacyId ? { intakeId, legacyId } : { intakeId, ...input }
  const version = sourceHash(snapshot)
  requireLawmaticsActive(options?.signal)
  const claimed = await claimExternalRecord({ ...ref, sourceVersion: version,
    idempotencyKey: `lawmatics:prospect:${intakeId}:${version}`, requestHash: version, requestSnapshot: snapshot })
  if (claimed.external_id) return claimed.external_id
  if (legacyId) {
    requireLawmaticsActive(options?.signal)
    await recordIntegrationSuccess({ ...ref, idempotencyKey: claimed.idempotency_key, externalId: legacyId })
    return legacyId
  }
  return createAndRecordLawmatics(ref, claimed, () => createLawmaticsProspect(input, options?.signal), existing, options?.signal)
}
