import 'server-only'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import {
  beginIntegrationAttempt, claimExternalRecord, getExternalRecord, recordIntegrationCancellation,
  recordIntegrationDisabled, recordIntegrationFailure, recordIntegrationSuccess, type ExternalRecordRef,
} from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'
import type { IntegrationResult } from '@/lib/integrations/types'
import { cancelLawmaticsEvent, createLawmaticsEvent, updateLawmaticsEvent } from './client'
import {
  createAndRecordLawmatics, isCompletedLawmaticsCancellation, lawmaticsDatabase, lawmaticsFailure, loadLawmaticsAppointment,
  requireLawmaticsActive, requireSafeCreate, resolveLawmaticsProspect, sourceHash,
} from './prospect'

async function requireEnabled(signal?: AbortSignal) {
  requireLawmaticsActive(signal)
  const settings = await getIntegrationSettings()
  requireLawmaticsActive(signal)
  if (!settings.lawmaticsAppointmentSyncEnabled) throw lawmaticsFailure('integration_disabled', 'Lawmatics appointment synchronization is disabled.')
}

/** The single canonical source definition used by the worker and reconciliation. */
export function buildLawmaticsAppointmentSource(
  appointment: Awaited<ReturnType<typeof loadLawmaticsAppointment>>,
  type: { key: string; label: string; location_type: string | null } | null,
  settings: Awaited<ReturnType<typeof getIntegrationSettings>>,
  timezone: string,
  prospectId: string | null,
) {
  const location = appointment.location_type ?? type?.location_type ?? null
  const snapshot = { appointmentId: appointment.id, status: appointment.status,
    start: appointment.start_time, end: appointment.end_time, typeId: appointment.appointment_type_id,
    typeKey: type?.key ?? null, typeLabel: type?.label ?? null, location,
    eventTypeId: (type ? settings.lawmaticsEventTypeIdMap[type.key] : undefined) ?? null,
    locationId: (location ? settings.lawmaticsLocationIdMap[location] : undefined) ?? null,
    userIds: [...new Set(settings.lawmaticsUserIds)].sort(), timezone, prospectId,
    linkedLeadId: appointment.linked_lead_id, linkedMatterId: appointment.linked_matter_id }
  return { snapshot, version: sourceHash(snapshot) }
}

export async function syncLawmaticsAppointment(appointmentId: string, signal?: AbortSignal): Promise<IntegrationResult> {
  requireLawmaticsActive(signal)
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
  if (!cancelled && (!type || !settings.lawmaticsEventTypeIdMap[type.key])) throw lawmaticsFailure('configuration_required', 'Configure a Lawmatics event type for this appointment type.')
  const ref: ExternalRecordRef = { provider: 'lawmatics', internalEntityType: 'appointment',
    internalEntityId: appointment.id, externalRecordType: 'event' }
  const existing = await getExternalRecord(ref)
  requireLawmaticsActive(signal)
  await requireSafeCreate(existing, ref)
  const prospectId = cancelled ? null : await resolveLawmaticsProspect(appointmentId, { signal })
  await requireEnabled(signal)
  const { snapshot, version } = buildLawmaticsAppointmentSource(appointment, type, settings, scheduling.timezone, prospectId)
  const { eventTypeId, locationId, userIds } = snapshot
  const result = (operation: IntegrationResult['operation'], externalId: string): IntegrationResult => ({
    provider: 'lawmatics', externalRecordType: 'event', externalId, operation,
  })
  if (existing?.status === 'synced' && existing.source_version === version) return result('reused', existing.external_id ?? '')
  const claimed = await claimExternalRecord({ ...ref, sourceVersion: version,
    idempotencyKey: `lawmatics:event:${appointment.id}:${version}`, requestSnapshot: snapshot, requestHash: version })
  if (claimed.status === 'synced' && claimed.source_version === version) return result('reused', claimed.external_id ?? '')

  if (!cancelled && !claimed.external_id) {
    const id = await createAndRecordLawmatics(ref, claimed, async () => {
      await requireEnabled(signal)
      return createLawmaticsEvent({
        name: type!.label, description: `Cornerstone appointment reference: ${appointment.id}`,
        start: appointment.start_time, end: appointment.end_time, timezone: scheduling.timezone,
        prospectId: prospectId!, eventTypeId: eventTypeId!, userIds, ...(locationId ? { locationId } : {}),
      }, signal)
    }, existing, signal)
    return result('created', id)
  }

  requireLawmaticsActive(signal)
  const fenced = await beginIntegrationAttempt({ ...ref, idempotencyKey: claimed.idempotency_key,
    expectedLastAttemptAt: claimed.last_attempt_at })
  const attempt = { ...ref, idempotencyKey: claimed.idempotency_key, attemptAt: fenced.last_attempt_at! }
  try {
    if (cancelled) {
      const alreadyCancelled = isCompletedLawmaticsCancellation(existing)
      if (claimed.external_id && !alreadyCancelled) {
        try {
          await requireEnabled(signal)
          await cancelLawmaticsEvent(claimed.external_id, signal)
        }
        catch (error) {
          // DELETE retries converge even after the first successful response was lost.
          if (!(error instanceof IntegrationError) || error.code !== 'not_found') throw error
        }
      }
      requireLawmaticsActive(signal)
      await recordIntegrationCancellation(attempt)
      return result('cancelled', claimed.external_id ?? '')
    }
    await requireEnabled(signal)
    await updateLawmaticsEvent(claimed.external_id!, {
      name: type!.label, description: `Cornerstone appointment reference: ${appointment.id}`,
      start: appointment.start_time, end: appointment.end_time, timezone: scheduling.timezone,
      prospectId: prospectId!, eventTypeId: eventTypeId!, userIds, ...(locationId ? { locationId } : {}),
    }, signal)
    requireLawmaticsActive(signal)
    await recordIntegrationSuccess({ ...attempt, externalId: claimed.external_id! })
    return result('updated', claimed.external_id!)
  } catch (error) {
    const safe = error instanceof IntegrationError ? error : lawmaticsFailure('synchronization_failed', 'Lawmatics synchronization could not be completed.', 'retryable')
    if (safe.code === 'integration_disabled') await recordIntegrationDisabled(attempt)
    else await recordIntegrationFailure({ ...attempt, error: safe })
    throw safe
  }
}
