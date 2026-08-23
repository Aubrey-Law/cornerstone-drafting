import { getAdminClient } from '@/lib/supabaseAdmin'

export interface CrmActivityListRow {
  id: string
  personId: string | null
  personName: string | null
  opportunityId: string | null
  opportunityName: string | null
  actorId: string | null
  actorName: string | null
  type: string
  eventType: string | null
  channel: string | null
  direction: string
  subject: string | null
  body: string | null
  source: string
  status: string
  createdAt: string
}

export interface CrmSyncEventRow {
  id: string
  provider: string | null
  direction: string
  entityType: string
  entityId: string
  eventName: string | null
  status: string
  attemptCount: number
  errorMessage: string | null
  availableAt: string
  createdAt: string
  completedAt: string | null
}

function uniqueIds(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export async function fetchCrmActivities(limit = 500): Promise<{ rows: CrmActivityListRow[]; error: string | null }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cornerstone_crm_activities')
    .select('id, person_id, performed_by_user_id, type, event_type, channel, direction, subject, body, source, status, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)))
  if (error) return { rows: [], error: error.message }

  const activities = data ?? []
  const personIds = uniqueIds(activities.map(row => row.person_id))
  const actorIds = uniqueIds(activities.map(row => row.performed_by_user_id))
  // The opportunity column is resolved through the person rather than the
  // `cornerstone_crm_opportunities` mirror, which is being retired. The person
  // carries the same intake id the mirror did, and its name is what the
  // mirror's title was built from, so the rendered column is unchanged.
  const [peopleResult, actorsResult] = await Promise.all([
    personIds.length
      ? admin.from('v_cornerstone_crm_people').select('id, name, client_intake_id').in('id', personIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; client_intake_id: string | null }>, error: null }),
    actorIds.length
      ? admin.from('users').select('id, display_name, email').in('id', actorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }>, error: null }),
  ])
  if (peopleResult.error || actorsResult.error) {
    return { rows: [], error: peopleResult.error?.message ?? actorsResult.error?.message ?? 'Could not load CRM references' }
  }

  const people = new Map((peopleResult.data ?? []).map(row => [row.id, {
    name: row.name as string | null,
    intakeId: row.client_intake_id as string | null,
  }]))
  const actors = new Map((actorsResult.data ?? []).map(row => [row.id, row.display_name || row.email || 'Staff member']))
  return {
    rows: activities.map(row => ({
      id: row.id,
      personId: row.person_id,
      personName: row.person_id ? people.get(row.person_id)?.name ?? null : null,
      // Only a person backed by an intake has a lead page to link to; a spouse
      // or other related contact resolves to no opportunity, as before.
      opportunityId: row.person_id ? people.get(row.person_id)?.intakeId ?? null : null,
      opportunityName: row.person_id && people.get(row.person_id)?.intakeId
        ? people.get(row.person_id)?.name ?? null
        : null,
      actorId: row.performed_by_user_id,
      actorName: row.performed_by_user_id ? actors.get(row.performed_by_user_id) ?? 'Staff member' : null,
      type: row.type,
      eventType: row.event_type,
      channel: row.channel,
      direction: row.direction,
      subject: row.subject,
      body: row.body,
      source: row.source,
      status: row.status,
      createdAt: row.created_at,
    })),
    error: null,
  }
}

export async function fetchCrmSyncEvents(limit = 500): Promise<{ rows: CrmSyncEventRow[]; error: string | null }> {
  const { data, error } = await getAdminClient()
    .from('cornerstone_crm_sync_events')
    .select('id, provider, direction, entity_type, entity_id, event_name, status, attempt_count, error_message, available_at, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 1000)))
  if (error) return { rows: [], error: error.message }
  return {
    rows: (data ?? []).map(row => ({
      id: row.id,
      provider: row.provider,
      direction: row.direction,
      entityType: row.entity_type,
      entityId: row.entity_id,
      eventName: row.event_name,
      status: row.status,
      attemptCount: row.attempt_count,
      errorMessage: row.error_message,
      availableAt: row.available_at,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
    error: null,
  }
}
