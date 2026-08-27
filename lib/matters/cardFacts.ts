import { practiceAreaLabel } from '@/lib/practiceArea'
import { matterLastActivityAt } from '@/lib/adminTables/matterTable'
import { mergeUnreviewedCounts, formatUnreviewedUploadLabel } from '@/lib/matter/unreviewedUploads'
import type { MatterListRow } from '@/lib/queries/matters'

/**
 * The facts a matter card has room for, derived once so the board, the dashboard,
 * the sidebar and the matter card cannot drift apart.
 *
 * This mirrors `lib/leads/cardFacts.ts`, which exists for the same reason. Before
 * this module the board's derivation lived inline in `MattersClient`, so every new
 * surface that wanted to show a matter copied it — and the copies were already
 * diverging on how they spelled "quiet".
 */

const DAY_MS = 86_400_000

/** Days since a timestamp, floored at zero so a clock skew never reads negative. */
export function matterDaysSince(ms: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

export function matterTitle(matter: MatterListRow): string {
  return matter.client_name || matter.matter_name || 'Untitled'
}

/** Matter number and practice area, the two things that identify a matter at a glance. */
export function matterSubtitle(matter: MatterListRow): string {
  return [matter.matter_number, practiceAreaLabel(matter.practice_area)].filter(Boolean).join(' · ')
}

export type MatterBadgeTone = 'success' | 'warning' | 'muted'

export interface MatterBadge {
  label: string
  tone: MatterBadgeTone
}

export function matterIntakeBadge(matter: MatterListRow): MatterBadge {
  const intake = matter.intake_status ?? ''
  return {
    label: intake.replace(/_/g, ' ') || '—',
    tone: intake === 'submitted' ? 'success' : intake ? 'warning' : 'muted',
  }
}

/**
 * When this matter last reached a milestone, and how long ago that was.
 *
 * `matterLastActivityAt` is a max over `documents_executed_at`, `drafts_sent_at`,
 * `intake_submitted_at` and `matter_created` — it is milestone recency, **not** an
 * activity feed. It does not move when an email, a note or a task lands. Every
 * label here says "milestone" rather than "activity" so a quiet-looking matter is
 * not mistaken for an untouched one.
 */
export function matterLastMilestoneAt(matter: MatterListRow): number | null {
  return matterLastActivityAt(matter)
}

export function matterQuietDays(matter: MatterListRow, now: number = Date.now()): number | null {
  const at = matterLastMilestoneAt(matter)
  return at === null ? null : matterDaysSince(at, now)
}

export function formatLastMilestone(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return '—'
  const days = matterDaysSince(ms, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

/**
 * How loudly to render a recency timestamp.
 *
 * Recent is legible, last week recedes, older recedes further. The point is that a
 * column of timestamps should be scannable by weight alone, without reading any of
 * them.
 */
export function matterRecencyTone(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'text-muted-foreground/60'
  const days = matterDaysSince(ms, now)
  if (days < 1) return 'text-foreground'
  if (days < 7) return 'text-muted-foreground'
  return 'text-muted-foreground/60'
}

/**
 * How loudly to render a deadline.
 *
 * Overdue and imminent earn colour; everything else stays neutral. Reserving
 * `text-red` for genuinely overdue is what keeps it meaning something — a board
 * where half the dates are red is a board with no signal in it.
 */
export function matterDeadlineTone(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'text-muted-foreground'
  const days = Math.floor((ms - now) / DAY_MS)
  if (days < 0) return 'text-red font-medium'
  if (days < 2) return 'text-amber font-medium'
  if (days < 7) return 'text-foreground'
  return 'text-muted-foreground'
}

/**
 * The trailing meta line: when it last moved, plus any uploads nobody has read.
 *
 * Unreviewed uploads are the one thing on a matter card that is a call to action
 * rather than a status, so it is appended only when the count is non-zero.
 */
export function matterMetaFacts(matter: MatterListRow, now: number = Date.now()): string[] {
  const unreviewed = mergeUnreviewedCounts(
    matter.unreviewed_intake_upload_count ?? 0,
    matter.unreviewed_portal_upload_count ?? 0,
  )
  return [
    formatLastMilestone(matterLastMilestoneAt(matter), now),
    ...(unreviewed.total > 0 ? [formatUnreviewedUploadLabel(unreviewed)] : []),
  ]
}
