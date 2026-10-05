import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadCeremony, type Ceremony } from '@/lib/ceremony/repository'
import { executionKinds, loadExecutionMatters } from '@/lib/execution/repository'
import { buildSigningDayKit, type SigningDayKit } from '@/lib/signing/kit'
import { reviewClient } from '@/lib/review/staff'
import { fetchDesignSheet } from '@/lib/queries/matterCore'
import { getExecutionMechanics } from '@/lib/designSheet/executionMechanics'
import { loadFirmSettings } from '@/lib/firmSettings'
import { firmOfficeAddress } from '@/lib/appointments/officeAddress'
import { listAppointmentTypes } from '@/lib/appointments/settings'

export interface SigningAppointmentSummary {
  id: string
  startIso: string
  location: string | null
}

export interface LoadedSigningKit {
  matterId: string
  kit: SigningDayKit
  ceremony: Ceremony | null
  appointment: SigningAppointmentSummary | null
  kinds: SigningDayKit['documents'][number]['kind'][]
}

/** The next signing appointment booked through the app for this matter, with a printable location. */
export async function loadSigningAppointment(matterId: string, now = new Date()): Promise<SigningAppointmentSummary | null> {
  const admin = getAdminClient()
  const types = await listAppointmentTypes().catch(() => [])
  const signingTypeIds = types.filter(type => type.key === 'signing_appointment').map(type => type.id)
  if (!signingTypeIds.length) return null
  const { data } = await admin.from('appointments')
    .select('id, start_time, location_type, online_meeting_url')
    .eq('linked_matter_id', matterId)
    .in('appointment_type_id', signingTypeIds)
    .in('status', ['scheduled', 'rescheduled'])
    .gte('start_time', new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const locationType = typeof data.location_type === 'string' ? data.location_type : null
  const location = locationType === 'in_person'
    ? firmOfficeAddress(await loadFirmSettings())
    : locationType === 'phone'
      ? 'By phone'
      : typeof data.online_meeting_url === 'string' && data.online_meeting_url
        ? `Video: ${data.online_meeting_url}`
        : locationType
  return { id: String(data.id), startIso: String(data.start_time), location }
}

/**
 * Everything the kit page and the kit action need for one matter. Null when
 * the matter is not hired or has no drafted documents.
 */
export async function loadSigningKit(matterId: string, options: { now?: Date } = {}): Promise<LoadedSigningKit | null> {
  const client = reviewClient()
  const [matter] = await loadExecutionMatters(client, { matterId })
  if (!matter || matter.documents.length === 0) return null
  const { kinds, unmatched } = executionKinds(matter)

  const admin = getAdminClient()
  const [pipelineRes, ceremony, appointment, sheet] = await Promise.all([
    admin.from('v_matter_pipeline').select('client_name, spouse_name').eq('matter_id', matterId).maybeSingle(),
    loadCeremony(client, matterId).catch(() => null),
    loadSigningAppointment(matterId, options.now),
    fetchDesignSheet(matterId).catch(() => null),
  ])
  const mechanics = sheet ? getExecutionMechanics(sheet) : null
  const clients = [pipelineRes.data?.client_name, pipelineRes.data?.spouse_name]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)

  const kit = buildSigningDayKit({
    matterName: matter.title,
    clients,
    kinds,
    unmatchedDocuments: unmatched,
    scheduledFor: ceremony?.scheduledFor ?? appointment?.startIso ?? null,
    location: ceremony?.location ?? appointment?.location ?? null,
    notaryName: ceremony?.notaryName ?? mechanics?.notary_name ?? null,
    witnessNames: [ceremony?.witnessOneName ?? null, ceremony?.witnessTwoName ?? null],
    healthCareAgentName: ceremony?.healthCareAgentName ?? null,
    signingCity: mechanics?.signing_city ?? null,
    now: options.now,
  })
  return { matterId, kit, ceremony, appointment, kinds }
}
