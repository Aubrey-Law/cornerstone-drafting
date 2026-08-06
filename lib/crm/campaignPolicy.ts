export type MarketingStatus = 'unknown' | 'opted_in' | 'opted_out'
export type MarketingRecordKind = 'lead' | 'client'
export type CampaignKind = 'newsletter' | 'nurture'

export type CampaignProfile = {
  marketingStatus: MarketingStatus
  recordKind: MarketingRecordKind
  email: string | null
}

export function canEnrollMarketingProfile(profile: CampaignProfile, campaignType: CampaignKind): boolean {
  if (profile.marketingStatus !== 'opted_in' || !profile.email?.trim()) return false
  return campaignType === 'newsletter' || profile.recordKind === 'lead'
}

export function isTerminalDeliveryStatus(status: string): boolean {
  return ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complaint', 'unsubscribed', 'failed', 'unknown'].includes(status)
}

export function mapMailgunEvent(event: string): string {
  const normalized = event.trim().toLowerCase()
  if (normalized === 'accepted') return 'sent'
  if (normalized === 'delivered') return 'delivered'
  if (normalized === 'opened') return 'opened'
  if (normalized === 'clicked') return 'clicked'
  if (normalized === 'permanent_fail') return 'bounced'
  if (normalized === 'complained') return 'complaint'
  if (normalized === 'unsubscribed') return 'unsubscribed'
  if (normalized === 'temporary_fail') return 'failed'
  return 'unknown'
}
