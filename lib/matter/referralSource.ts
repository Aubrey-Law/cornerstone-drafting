/**
 * Where the matter came from. Free text made the lead-source report useless —
 * "Google", "google search" and "Web" were three sources. The picklist is the
 * answer; `referral_source_other` carries the long tail so nothing is lost.
 */

export const REFERRAL_SOURCE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'client_referral', label: 'Client referral' },
  { value: 'professional_referral', label: 'Professional referral' },
  { value: 'friend_family', label: 'Friend or family' },
  { value: 'google', label: 'Google / search' },
  { value: 'website', label: 'Website' },
  { value: 'social', label: 'Social media' },
  { value: 'seminar', label: 'Seminar or event' },
  { value: 'legal_plan', label: 'Legal plan' },
  { value: 'returning_client', label: 'Returning client' },
  { value: 'other', label: 'Other' },
] as const

export type ReferralSource = (typeof REFERRAL_SOURCE_OPTIONS)[number]['value']

const KNOWN = new Set(REFERRAL_SOURCE_OPTIONS.map(option => option.value as string))

/**
 * Legacy rows hold free text. Anything the picklist does not recognise reads
 * back as "Other" so the stored words still show in the Other field rather
 * than silently disappearing behind a blank select.
 */
export function normalizeReferralSource(value: unknown): ReferralSource {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const slug = trimmed.toLowerCase().replace(/[\s/-]+/g, '_')
  if (KNOWN.has(slug)) return slug as ReferralSource
  if (slug.includes('google') || slug.includes('search')) return 'google'
  if (slug.includes('seminar') || slug.includes('event')) return 'seminar'
  if (slug.includes('web')) return 'website'
  if (slug.includes('social') || slug.includes('facebook') || slug.includes('instagram')) return 'social'
  if (slug.includes('referral')) return 'client_referral'
  return 'other'
}

export function referralSourceLabel(value: unknown): string {
  const normalized = normalizeReferralSource(value)
  if (!normalized) return '—'
  return REFERRAL_SOURCE_OPTIONS.find(option => option.value === normalized)?.label ?? normalized
}

/** Free text for the Other field: whatever is stored, when it is not a known key. */
export function referralSourceOtherFallback(
  referralSource: string | null | undefined,
  referralSourceOther: string | null | undefined,
): string {
  if (referralSourceOther?.trim()) return referralSourceOther
  const raw = referralSource?.trim() ?? ''
  return raw && !KNOWN.has(raw) ? raw : ''
}

/** Whole days since the last communication, or null when there has never been one. */
export function quietDays(lastContactAt: string | null | undefined, now = new Date()): number | null {
  if (!lastContactAt) return null
  const then = Date.parse(lastContactAt)
  if (Number.isNaN(then)) return null
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  return days < 0 ? 0 : days
}
