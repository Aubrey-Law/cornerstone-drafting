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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export type EngagementSignedAtResult = { ok: true; value: string | null } | { ok: false }

/**
 * The signed date is a calendar day to the attorney but a timestamptz in the
 * column. Store a bare day at midday UTC: the facts panel reads the stamp back
 * on the UTC calendar and the SLA views read it in the firm timezone, and
 * midday is the only hour neither can roll to the day before.
 *
 * An empty value clears the date. A full timestamp (the e-sign webhook's, or a
 * value already stored) passes through as an ISO string.
 */
export function normalizeEngagementSignedAt(value: unknown): EngagementSignedAtResult {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (DATE_ONLY.test(trimmed)) {
    const normalized = `${trimmed}T12:00:00.000Z`
    const parsed = Date.parse(normalized)
    if (Number.isNaN(parsed)) return { ok: false }
    // Date.parse rolls 2026-02-31 over to March 3rd; a silent roll would date
    // the engagement, and everything anchored to it, to the wrong day.
    if (new Date(parsed).toISOString().slice(0, 10) !== trimmed) return { ok: false }
    return { ok: true, value: normalized }
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return { ok: false }
  return { ok: true, value: parsed.toISOString() }
}

/**
 * The signed date and the status columns are one fact. Setting a date means the
 * engagement was signed — on paper, in another system, whenever — so the legacy
 * flag and status follow it. Clearing the date un-signs it, otherwise the row
 * would keep reading "signed" with nothing to show for it and
 * deriveEngagementStatus would agree. A cleared row falls back to whatever it
 * was before signing: a draft stays a draft, a declined engagement was never
 * signed, and anything with a sent stamp is back to sent.
 */
export function engagementPatchForSignedAt(
  signedAt: string | null,
  existing:
    | Pick<MatterDetailsRow, 'engagement_status' | 'engagement_sent_at'>
    | null
    | undefined,
): {
  engagement_signed_at: string | null
  engagement_signed: boolean
  engagement_status: string | null
} {
  if (signedAt) {
    return {
      engagement_signed_at: signedAt,
      engagement_signed: true,
      engagement_status: 'signed',
    }
  }
  const previous = existing?.engagement_status
  const status =
    previous === 'draft' || previous === 'sent' || previous === 'declined'
      ? previous
      : existing?.engagement_sent_at
        ? 'sent'
        : null
  return { engagement_signed_at: null, engagement_signed: false, engagement_status: status }
}
