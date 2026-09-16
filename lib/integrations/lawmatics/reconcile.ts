import 'server-only'

import { getIntegrationSettings } from '@/lib/integrations/settings'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import { getExternalRecord } from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'
import { buildLawmaticsAppointmentSource } from './appointments'
import { enqueueLawmaticsAppointmentSync } from './jobs'
import { lawmaticsDatabase, lawmaticsFailure, resolveLawmaticsProspect } from './prospect'

/** Bounded repair only; all provider work remains in the durable worker. */
export async function reconcileLawmaticsAppointments(limit = 100): Promise<{ scanned: number; enqueued: number }> {
  const counts = { scanned: 0, enqueued: 0 }
  const settings = await getIntegrationSettings()
  if (!settings.lawmaticsAppointmentSyncEnabled) return counts
  const cap = Number.isFinite(limit) ? Math.min(100, Math.max(0, Math.floor(limit))) : 0
  if (!cap) return counts
  const scheduling = await getSchedulingSettings()
  let cursor: { id: string; updated_at: string } | undefined
  while (counts.scanned < cap) {
    const batchSize = Math.min(25, cap - counts.scanned)
    let query = lawmaticsDatabase().from('appointments')
      .select('id, source, status, appointment_type_id, start_time, end_time, location_type, linked_lead_id, linked_matter_id, updated_at')
      .in('source', ['public', 'portal', 'admin'])
      .order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(batchSize)
    // Both cursor fields come from typed database columns (timestamptz/uuid).
    if (cursor) query = query.or(`updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`)
    const { data: appointments, error } = await query
    if (error) throw lawmaticsFailure('source_unavailable', 'Appointments could not be read.', 'retryable')
    if (!appointments?.length) break
    for (const appointment of appointments) {
      counts.scanned++
      const existing = await getExternalRecord({ provider: 'lawmatics', internalEntityType: 'appointment',
        internalEntityId: appointment.id, externalRecordType: 'event' })
      // Staff must resolve attention. A newer source does not authorize retrying
      // an ambiguous POST or a delivery rejected for credentials/permissions.
      if (existing?.status === 'attention') continue
      const { data: type, error } = await lawmaticsDatabase().from('appointment_types')
        .select('id, key, label, location_type').eq('id', appointment.appointment_type_id).maybeSingle()
      if (error) throw lawmaticsFailure('source_unavailable', 'The appointment type could not be read.', 'retryable')
      let prospectId: string | null = null
      if (appointment.status !== 'cancelled') {
        try { prospectId = await resolveLawmaticsProspect(appointment.id, { readOnly: true }) }
        catch (error) {
          // Let the worker persist missing/conflicting identity as attention.
          if (!(error instanceof IntegrationError) || error.kind === 'retryable') throw error
        }
      }
      const canCompare = appointment.status === 'cancelled' || prospectId !== null
      const { version } = buildLawmaticsAppointmentSource(appointment, type, settings, scheduling.timezone, prospectId)
      if (canCompare && existing?.status === 'synced' && existing.source_version === version) continue
      const job = await enqueueLawmaticsAppointmentSync(appointment.id, null, {
        ...(canCompare ? { sourceVersion: version } : {}),
        reopenTerminal: existing?.status === 'disabled',
      })
      if (job) counts.enqueued++
    }
    cursor = appointments[appointments.length - 1]
    if (appointments.length < batchSize) break
  }
  return counts
}
