export interface SidebarCounts {
  /** Categories whose latest refresh failed; never display these as confirmed zero. */
  errors?: string[]
  inboxNeedsReplyCount: number
  /** Triaged email waiting on a reply. Distinct from portal messages above. */
  emailTriageNeedsReplyCount: number
  intakeReviewCount: number
  draftingNeedsDesignCount: number
  agingRedCount: number
  agingAmberCount: number
  tasksOverdueCount: number
  /** Issued invoices past their due date with a balance outstanding. */
  overdueInvoiceCount: number
}

export type SidebarBadgeTone = 'destructive' | 'accent'

export interface SidebarBadge {
  value: number
  tone: SidebarBadgeTone
  /**
   * The last count that loaded, shown because the newest refresh of this
   * category failed. Rendered differently and announced as out of date — a
   * stale "3 overdue" is useful, a stale one presented as current is not.
   */
  stale?: boolean
}

/**
 * Which counts each failing section takes down with it. The keys are the ones
 * `fetchSidebarCounts` pushes into `errors`, which are section names rather
 * than count names — `aging` alone feeds two counts.
 */
const COUNTS_BY_SECTION: Record<string, (keyof SidebarCounts)[]> = {
  intakeReviewCount: ['intakeReviewCount'],
  draftingNeedsDesignCount: ['draftingNeedsDesignCount'],
  aging: ['agingRedCount', 'agingAmberCount'],
  tasksOverdueCount: ['tasksOverdueCount'],
  inboxNeedsReplyCount: ['inboxNeedsReplyCount'],
  emailTriageNeedsReplyCount: ['emailTriageNeedsReplyCount'],
  overdueInvoiceCount: ['overdueInvoiceCount'],
}

/** The counts invalidated by this response's failed sections. */
function failedCounts(errors: string[] | undefined): Set<keyof SidebarCounts> {
  const out = new Set<keyof SidebarCounts>()
  for (const section of errors ?? []) {
    for (const key of COUNTS_BY_SECTION[section] ?? []) out.add(key)
  }
  return out
}

/** True when this nav item's badge is drawn from a count that failed to refresh. */
function isStale(href: string, counts: SidebarCounts): boolean {
  const failed = failedCounts(counts.errors)
  if (href === '/admin') return failed.has('inboxNeedsReplyCount')
  if (href === '/admin/matters' || href === '/admin/matters/list') return failed.has('intakeReviewCount')
  if (href === '/admin/drafting') {
    return failed.has('agingRedCount') || failed.has('draftingNeedsDesignCount')
  }
  if (href === '/admin/email-triage') return failed.has('emailTriageNeedsReplyCount')
  if (href === '/admin/tasks') return failed.has('tasksOverdueCount')
  if (href === '/admin/billing') return failed.has('overdueInvoiceCount')
  return false
}

export const EMPTY_SIDEBAR_COUNTS: SidebarCounts = {
  inboxNeedsReplyCount: 0,
  emailTriageNeedsReplyCount: 0,
  intakeReviewCount: 0,
  draftingNeedsDesignCount: 0,
  agingRedCount: 0,
  agingAmberCount: 0,
  tasksOverdueCount: 0,
  overdueInvoiceCount: 0,
}

/**
 * The badge for a nav item, or null when there is nothing to show.
 *
 * A category whose refresh failed used to return null, which hid the badge —
 * and a hidden badge reads as "nothing needs your attention", which is the one
 * meaning it must never carry. `mergeSidebarCounts` keeps the last good value
 * through a failure, so that value is shown and marked stale instead. When
 * nothing has ever loaded there is genuinely nothing to show and null is right.
 */
export function getNavBadge(href: string, counts: SidebarCounts): SidebarBadge | null {
  const stale = isStale(href, counts)
  const badge = (value: number, tone: SidebarBadgeTone): SidebarBadge =>
    stale ? { value, tone, stale: true } : { value, tone }

  if (href === '/admin' && counts.inboxNeedsReplyCount > 0) {
    return badge(counts.inboxNeedsReplyCount, 'accent')
  }
  if ((href === '/admin/matters' || href === '/admin/matters/list') && counts.intakeReviewCount > 0) {
    return badge(counts.intakeReviewCount, 'destructive')
  }
  if (href === '/admin/drafting') {
    // Aging folded into the Drafting hub: overdue matters take badge priority.
    if (counts.agingRedCount > 0) return badge(counts.agingRedCount, 'destructive')
    if (counts.draftingNeedsDesignCount > 0) return badge(counts.draftingNeedsDesignCount, 'accent')
    if (counts.agingAmberCount > 0) return badge(counts.agingAmberCount, 'accent')
  }
  // Accent, not destructive: unanswered mail is work waiting, not the firm
  // being owed or a missed deadline.
  if (href === '/admin/email-triage' && counts.emailTriageNeedsReplyCount > 0) {
    return badge(counts.emailTriageNeedsReplyCount, 'accent')
  }
  if (href === '/admin/tasks' && counts.tasksOverdueCount > 0) {
    return badge(counts.tasksOverdueCount, 'destructive')
  }
  // Late money is destructive, not accent: an overdue invoice is the firm
  // being owed, which is the same urgency as an overdue task.
  if (href === '/admin/billing' && counts.overdueInvoiceCount > 0) {
    return badge(counts.overdueInvoiceCount, 'destructive')
  }
  return null
}

/**
 * Fold a response into the counts already on screen.
 *
 * The subtlety is that a failed section is not absent from the response — the
 * server substitutes its fallback, which is `0`. `??` does not fall back on a
 * zero, so taking the response at face value replaced every failed count with
 * "nothing to do" and destroyed the value the badge could otherwise have kept
 * showing. Counts named in `errors` keep what they had.
 */
export function mergeSidebarCounts(
  prev: SidebarCounts,
  next: Partial<SidebarCounts> | null | undefined,
): SidebarCounts {
  if (!next) return prev
  const failed = failedCounts(next.errors)
  const take = (key: Exclude<keyof SidebarCounts, 'errors'>): number =>
    failed.has(key) ? prev[key] : next[key] ?? prev[key]

  return {
    errors: next.errors ?? [],
    inboxNeedsReplyCount: take('inboxNeedsReplyCount'),
    emailTriageNeedsReplyCount: take('emailTriageNeedsReplyCount'),
    intakeReviewCount: take('intakeReviewCount'),
    draftingNeedsDesignCount: take('draftingNeedsDesignCount'),
    agingRedCount: take('agingRedCount'),
    agingAmberCount: take('agingAmberCount'),
    tasksOverdueCount: take('tasksOverdueCount'),
    overdueInvoiceCount: take('overdueInvoiceCount'),
  }
}
