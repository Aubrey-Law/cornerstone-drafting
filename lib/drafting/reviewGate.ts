// Pure decision for whether a generated draft may be promoted to a
// client-visible folder. Shared by the UI (to disable the promote button) and
// mirrored server-side in app/api/documents/[id]/route.ts so a hand-crafted
// PATCH can't bypass it.

export interface DraftPromotionState {
  /** Unresolved-marker count from markerScan; null on pre-WP4/legacy drafts. */
  markerCount: number | null
  /** When an attorney signed off on this draft; null if not yet reviewed. */
  reviewedAt: string | null
}

export type DraftPromotionBlock = 'markers' | 'not_reviewed'

export interface DraftPromotionResult {
  ok: boolean
  /** Why promotion is blocked, for tooltip/UI; absent when ok. */
  reason?: DraftPromotionBlock
}

/**
 * A draft is promotable only when it is free of unresolved markers AND an
 * attorney has marked it reviewed. Legacy drafts with an unknown marker count
 * (null) are not blocked on markers but still require review.
 */
export function canPromoteDraft({ markerCount, reviewedAt }: DraftPromotionState): DraftPromotionResult {
  if (typeof markerCount === 'number' && markerCount > 0) return { ok: false, reason: 'markers' }
  if (!reviewedAt) return { ok: false, reason: 'not_reviewed' }
  return { ok: true }
}
