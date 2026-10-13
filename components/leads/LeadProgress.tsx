import { Badge } from '@/components/ui/badge'
import type { LeadListRow } from '@/lib/leads/viewTypes'

export function isLeadIntakeComplete(lead: LeadListRow): boolean {
  return Boolean(lead.intake_completed_at) || lead.status === 'completed'
}

/** The stage the list row is in, one name, the same shape as a matter stage badge. */
export function leadListStageName(lead: LeadListRow): string {
  if (lead.lead_status === 'lost') return 'Lost'
  if (lead.lead_status === 'declined' || lead.engagement_status === 'declined') return 'Declined'
  if (lead.lead_status === 'hired') return 'Hired'
  if (!isLeadIntakeComplete(lead)) return 'Intake'
  if (lead.engagement_status !== 'signed') return 'Engagement'
  return 'Hired'
}

export function LeadProgress({ lead }: { lead: LeadListRow }) {
  return <Badge variant="secondary">{leadListStageName(lead)}</Badge>
}
