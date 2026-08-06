export type MarketingConsentStatus = 'unknown' | 'opted_in' | 'opted_out'

export const MARKETING_CONSENT_LABEL: Record<MarketingConsentStatus, string> = {
  unknown: 'Unknown',
  opted_in: 'Opted in',
  opted_out: 'Opted out',
}

export function normalizeMarketingConsent(value: unknown): MarketingConsentStatus {
  return value === 'opted_in' || value === 'opted_out' ? value : 'unknown'
}

/**
 * Nurture email is marketing, not matter correspondence: only an explicit
 * opt-in clears it. Portal messages, SMS and one-to-one email about the
 * matter are unaffected.
 */
export function canSendNurture(status: MarketingConsentStatus): boolean {
  return status === 'opted_in'
}
