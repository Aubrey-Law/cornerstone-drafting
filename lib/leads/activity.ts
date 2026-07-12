export interface ActivityIdentity { id: string; role: string }
export interface LeadActivityLike { id?: string; eventType?: string; actorId?: string | null; createdAt: string; sourceLeadActivityId?: string | null }

export function canDeleteLeadActivity(activity: Pick<LeadActivityLike, 'eventType' | 'actorId'>, user: ActivityIdentity) {
  return activity.eventType === 'note' && (activity.actorId === user.id || user.role === 'admin')
}

export function mergeLeadAndMatterActivity<T extends LeadActivityLike>(lead: T[], matter: T[]): T[] {
  const represented = new Set(matter.map(row => row.sourceLeadActivityId).filter(Boolean))
  return [...matter, ...lead.filter(row => !row.id || !represented.has(row.id))]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
