import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * Engagement-agreement status shown on the matter page.
 *
 * Stored in matter_details.engagement_status as 'draft' | 'sent' | 'signed'
 * (the e-sign webhook also writes 'declined'; null = not sent). Older rows may
 * only have the legacy engagement_signed / engagement_sent_at columns set, so
 * deriveEngagementStatus reconciles all three.
 */
export type EngagementStatus = 'not_sent' | 'draft' | 'sent' | 'signed' | 'declined'

export const ENGAGEMENT_STATUS_OPTIONS: {
  value: Exclude<EngagementStatus, 'declined'>
  label: string
}[] = [
  { value: 'not_sent', label: 'Not sent' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'signed', label: 'Signed' },
]

const LABELS: Record<EngagementStatus, string> = {
  not_sent: 'Not sent',
  draft: 'Draft',
  sent: 'Sent',
  signed: 'Signed',
  declined: 'Declined',
}

export function deriveEngagementStatus(
  details:
    | Pick<MatterDetailsRow, 'engagement_status' | 'engagement_signed' | 'engagement_sent_at'>
    | null
    | undefined,
): EngagementStatus {
  if (details?.engagement_signed || details?.engagement_status === 'signed') return 'signed'
  if (details?.engagement_status === 'declined') return 'declined'
  if (details?.engagement_status === 'sent' || details?.engagement_sent_at) return 'sent'
  if (details?.engagement_status === 'draft') return 'draft'
  return 'not_sent'
}

export function engagementStatusLabel(status: EngagementStatus): string {
  return LABELS[status]
}
