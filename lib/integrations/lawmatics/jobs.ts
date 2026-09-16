import 'server-only'

import { enqueueWorkflowJob } from '@/lib/workflowJobs'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { getExternalRecord, type ExternalRecord, type ExternalRecordRef } from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'
import { lawmaticsDatabase, lawmaticsFailure, sourceHash } from './prospect'
import { syncLawmaticsAppointment } from './appointments'

export async function enqueueLawmaticsAppointmentSync(appointmentId: string, actorId?: string | null,
  options: { reopenTerminal?: boolean } = {}) {
  if (!(await getIntegrationSettings()).lawmaticsAppointmentSyncEnabled) return
  const { data, error } = await lawmaticsDatabase().from('appointments')
    .select('id, source, status, appointment_type_id, start_time, end_time, location_type, linked_lead_id, linked_matter_id, updated_at')
    .eq('id', appointmentId).maybeSingle()
  if (error || !data) throw new Error('Unable to read appointment for synchronization.')
  if (data.source === 'calendly') return
  const sourceVersion = sourceHash(data)
  const dedupeKey = `lawmatics:appointment:event:${appointmentId}:${sourceVersion}`
  const job = await enqueueWorkflowJob({ type: 'lawmatics_sync_appointment', dedupeKey,
    payload: { appointmentId, sourceVersion }, actorId })
  // Reconciliation must first establish disabled state or another approved repair
  // case. Ordinary booking hooks never restart attention/succeeded deliveries.
  if (options.reopenTerminal) {
    const { error } = await lawmaticsDatabase().rpc('reopen_integration_workflow_job', {
      p_job_type: 'lawmatics_sync_appointment', p_dedupe_key: dedupeKey,
    })
    if (error) throw persistenceFailure()
  }
  return job
}

function persistenceFailure() {
  return lawmaticsFailure('integration_persistence_failed', 'Unable to persist or read integration record.', 'retryable')
}

/** Preflight failures have no provider attempt. Preserve all Task 3 attempt fences. */
async function recordNonAttemptState(ref: ExternalRecordRef, sourceVersion: string,
  before: ExternalRecord | null, status: 'attention' | 'disabled', failure?: IntegrationError) {
  const admin = lawmaticsDatabase()
  const patch = { status, last_error_code: failure?.code ?? null, last_error_message: failure?.safeMessage ?? null }
  if (!before) {
    // A service may already have persisted a fenced failure. Never merge over it.
    const { error } = await admin.from('integration_external_records').upsert({
      provider: ref.provider, internal_entity_type: ref.internalEntityType, internal_entity_id: ref.internalEntityId,
      external_record_type: ref.externalRecordType, source_version: sourceVersion,
      idempotency_key: `lawmatics:event:${ref.internalEntityId}:preflight:${sourceVersion}`, ...patch,
    }, { onConflict: 'provider,internal_entity_type,internal_entity_id,external_record_type', ignoreDuplicates: true })
      .select('*').maybeSingle()
    if (error) throw persistenceFailure()
    return
  }
  // An unresolved provider attempt must retain its outcome evidence, even when
  // a queued job observes disablement. No new attempt timestamp is fabricated.
  if ((status === 'disabled' && before.last_attempt_at)
    || (before.status === 'pending' && before.last_attempt_at && !before.last_error_code)
    || (before.status === 'attention' && status === 'attention')) return
  let update = admin.from('integration_external_records').update(patch)
    .eq('provider', ref.provider).eq('internal_entity_type', ref.internalEntityType)
    .eq('internal_entity_id', ref.internalEntityId).eq('external_record_type', ref.externalRecordType)
    .eq('idempotency_key', before.idempotency_key).eq('status', before.status)
  update = before.last_attempt_at === null ? update.is('last_attempt_at', null)
    : update.eq('last_attempt_at', before.last_attempt_at)
  const { error } = await update.select('*').maybeSingle()
  if (error) throw persistenceFailure()
}

export async function runLawmaticsAppointmentSyncJob(appointmentId: string, sourceVersion: string) {
  const ref: ExternalRecordRef = { provider: 'lawmatics', internalEntityType: 'appointment',
    internalEntityId: appointmentId, externalRecordType: 'event' }
  const leaseArgs = { p_provider: 'lawmatics', p_entity_type: 'appointment', p_entity_id: appointmentId }
  try {
    if (!(await getIntegrationSettings()).lawmaticsAppointmentSyncEnabled) {
      await recordNonAttemptState(ref, sourceVersion, await getExternalRecord(ref), 'disabled')
      return
    }
    const { data: leaseToken, error: leaseError } = await lawmaticsDatabase()
      .rpc('acquire_integration_entity_lease', leaseArgs)
    if (leaseError) throw persistenceFailure()
    if (!leaseToken) throw lawmaticsFailure('integration_busy', 'Appointment synchronization is already running.', 'retryable')
    try {
      const before = await getExternalRecord(ref)
      if (!(await getIntegrationSettings()).lawmaticsAppointmentSyncEnabled) {
        await recordNonAttemptState(ref, sourceVersion, before, 'disabled')
        return
      }
      try {
        // Read current source state; old queued versions must converge to it.
        await syncLawmaticsAppointment(appointmentId)
      } catch (error) {
        if (!(error instanceof IntegrationError) || error.kind === 'retryable') throw error
        await recordNonAttemptState(ref, sourceVersion, before,
          error.code === 'integration_disabled' ? 'disabled' : 'attention', error)
      }
    } finally {
      const { data: released, error } = await lawmaticsDatabase().rpc('release_integration_entity_lease', {
        ...leaseArgs, p_lease_token: leaseToken,
      })
      if (error || !released) throw persistenceFailure()
    }
  } catch (error) {
    if (error instanceof IntegrationError) throw error
    // The generic workflow runner stores Error.message. Never let database or
    // provider response bodies reach it through unexpected exceptions.
    throw lawmaticsFailure('synchronization_failed', 'Lawmatics synchronization could not be completed.', 'retryable')
  }
}
