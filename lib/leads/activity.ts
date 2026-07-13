import type { ActivityEventType, MatterActivity } from '@/types/database'

export interface ActivityIdentity { id: string; role: string }
export interface LeadActivityLike { id?: string; eventType?: string; actorId?: string | null; createdAt: string; sourceMatterActivityId?: string | null }

export function canDeleteLeadActivity(activity: Pick<LeadActivityLike, 'eventType' | 'actorId'>, user: ActivityIdentity) {
  return activity.eventType === 'note' && (activity.actorId === user.id || user.role === 'admin')
}

export function mergeLeadAndMatterActivity<T extends LeadActivityLike>(lead: T[], matter: T[]): T[] {
  const matterIds = new Set(matter.map(row => row.id).filter(Boolean))
  return [...matter, ...lead.filter(row => !row.sourceMatterActivityId || !matterIds.has(row.sourceMatterActivityId))]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

interface LeadActivityLoaderRow {
  id: string
  event_type: string
  title: string
  detail: string | null
  actor_id: string | null
  created_at: string
  source_matter_activity_id: string | null
}

export function buildLinkedMatterActivity(
  matterId: string,
  leadRows: LeadActivityLoaderRow[],
  matterRows: MatterActivity[],
): MatterActivity[] {
  const lead = leadRows.map(row => ({
    id: row.id,
    matter_id: matterId,
    event_type: row.event_type as ActivityEventType,
    actor_id: row.actor_id,
    actor_email: null,
    actor_name: null,
    title: row.title,
    detail: row.detail,
    metadata: { origin: 'lead', source_lead_activity_id: row.id },
    created_at: row.created_at,
    createdAt: row.created_at,
    sourceMatterActivityId: row.source_matter_activity_id,
  }))
  const matter = matterRows.map(row => ({ ...row, createdAt: row.created_at }))
  return mergeLeadAndMatterActivity(lead, matter)
    .map(row => row.metadata?.origin === 'lead' ? { ...row, id: `lead:${row.id}` } : row)
}
