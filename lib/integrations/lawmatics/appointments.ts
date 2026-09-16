import 'server-only'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import {
  beginIntegrationAttempt, claimExternalRecord, getExternalRecord, recordIntegrationCancellation,
  recordIntegrationFailure, recordIntegrationSuccess, type ExternalRecordRef,
} from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'
import type { IntegrationResult } from '@/lib/integrations/types'
import { cancelLawmaticsEvent, createLawmaticsEvent, updateLawmaticsEvent } from './client'
import {
  createAndRecordLawmatics, isCompletedLawmaticsCancellation, lawmaticsDatabase, lawmaticsFailure, loadLawmaticsAppointment,
  requireSafeCreate, resolveLawmaticsProspect, sourceHash,
} from './prospect'

export async function syncLawmaticsAppointment(appointmentId: string): Promise<IntegrationResult> {
  const appointment = await loadLawmaticsAppointment(appointmentId)
  const settings = await getIntegrationSettings()
  if (!settings.lawmaticsAppointmentSyncEnabled) throw lawmaticsFailure('integration_disabled', 'Lawmatics appointment synchronization is disabled.')
  const [{ data: type, error }, scheduling] = await Promise.all([
    lawmaticsDatabase().from('appointment_types').select('id, key, label, location_type')
      .eq('id', appointment.appointment_type_id).maybeSingle(),
    getSchedulingSettings(),
  ])
  if (error) throw lawmaticsFailure('source_unavailable', 'The appointment type could not be read.', 'retryable')
  const cancelled = appointment.status === 'cancelled'
  const location = appointment.location_type ?? type?.location_type ?? null
  const eventTypeId = type ? settings.lawmaticsEventTypeIdMap[type.key] : undefined
  if (!cancelled && (!type || !eventTypeId)) throw lawmaticsFailure('configuration_required', 'Configure a Lawmatics event type for this appointment type.')
  const locationId = location ? settings.lawmaticsLocationIdMap[location] : undefined
  const userIds = [...new Set(settings.lawmaticsUserIds)].sort()
  const ref: ExternalRecordRef = { provider: 'lawmatics', internalEntityType: 'appointment',
    internalEntityId: appointment.id, externalRecordType: 'event' }
  const existing = await getExternalRecord(ref)
  requireSafeCreate(existing)
  const prospectId = cancelled ? null : await resolveLawmaticsProspect(appointmentId)
  const snapshot = { appointmentId: appointment.id, status: appointment.status,
    start: appointment.start_time, end: appointment.end_time, typeId: appointment.appointment_type_id,
    typeKey: type?.key ?? null, typeLabel: type?.label ?? null, location,
    eventTypeId: eventTypeId ?? null, locationId: locationId ?? null, userIds, timezone: scheduling.timezone, prospectId,
    linkedLeadId: appointment.linked_lead_id, linkedMatterId: appointment.linked_matter_id }
  const version = sourceHash(snapshot)
  const result = (operation: IntegrationResult['operation'], externalId: string): IntegrationResult => ({
    provider: 'lawmatics', externalRecordType: 'event', externalId, operation,
  })
  if (existing?.status === 'synced' && existing.source_version === version) return result('reused', existing.external_id ?? '')
  const claimed = await claimExternalRecord({ ...ref, sourceVersion: version,
    idempotencyKey: `lawmatics:event:${appointment.id}:${version}`, requestSnapshot: snapshot, requestHash: version })
  if (claimed.status === 'synced' && claimed.source_version === version) return result('reused', claimed.external_id ?? '')

  if (!cancelled && !claimed.external_id) {
    const id = await createAndRecordLawmatics(ref, claimed, () => createLawmaticsEvent({
      name: type!.label, description: `Cornerstone appointment reference: ${appointment.id}`,
      start: appointment.start_time, end: appointment.end_time, timezone: scheduling.timezone,
      prospectId: prospectId!, eventTypeId: eventTypeId!, userIds, ...(locationId ? { locationId } : {}),
    }), existing)
    return result('created', id)
  }

  const fenced = await beginIntegrationAttempt({ ...ref, idempotencyKey: claimed.idempotency_key,
    expectedLastAttemptAt: claimed.last_attempt_at })
  const attempt = { ...ref, idempotencyKey: claimed.idempotency_key, attemptAt: fenced.last_attempt_at! }
  try {
    if (cancelled) {
      const alreadyCancelled = isCompletedLawmaticsCancellation(existing)
      if (claimed.external_id && !alreadyCancelled) {
        try { await cancelLawmaticsEvent(claimed.external_id) }
        catch (error) {
          // DELETE retries converge even after the first successful response was lost.
          if (!(error instanceof IntegrationError) || error.code !== 'not_found') throw error
        }
      }
      await recordIntegrationCancellation(attempt)
      return result('cancelled', claimed.external_id ?? '')
    }
    await updateLawmaticsEvent(claimed.external_id!, {
      name: type!.label, description: `Cornerstone appointment reference: ${appointment.id}`,
      start: appointment.start_time, end: appointment.end_time, timezone: scheduling.timezone,
      prospectId: prospectId!, eventTypeId: eventTypeId!, userIds, ...(locationId ? { locationId } : {}),
    })
    await recordIntegrationSuccess({ ...attempt, externalId: claimed.external_id! })
    return result('updated', claimed.external_id!)
  } catch (error) {
    const safe = error instanceof IntegrationError ? error : lawmaticsFailure('synchronization_failed', 'Lawmatics synchronization could not be completed.', 'retryable')
    await recordIntegrationFailure({ ...attempt, error: safe })
    throw safe
  }
}
