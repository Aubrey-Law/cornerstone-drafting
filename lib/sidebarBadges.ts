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

export function getNavBadge(href: string, counts: SidebarCounts): SidebarBadge | null {
  const category = href === '/admin' ? 'inboxNeedsReplyCount' : href.startsWith('/admin/matters') ? 'intakeReviewCount'
    : href === '/admin/email-triage' ? 'emailTriageNeedsReplyCount'
    : href === '/admin/tasks' ? 'tasksOverdueCount' : href === '/admin/billing' ? 'overdueInvoiceCount' : null
  if (category && counts.errors?.includes(category)) return null
  if (href === '/admin/drafting' && counts.errors?.some(key => key === 'aging' || key === 'draftingNeedsDesignCount')) return null
  if (href === '/admin' && counts.inboxNeedsReplyCount > 0) {
    return { value: counts.inboxNeedsReplyCount, tone: 'accent' }
  }
  if ((href === '/admin/matters' || href === '/admin/matters/list') && counts.intakeReviewCount > 0) {
    return { value: counts.intakeReviewCount, tone: 'destructive' }
  }
  if (href === '/admin/drafting') {
    // Aging folded into the Drafting hub: overdue matters take badge priority.
    if (counts.agingRedCount > 0) return { value: counts.agingRedCount, tone: 'destructive' }
    if (counts.draftingNeedsDesignCount > 0) return { value: counts.draftingNeedsDesignCount, tone: 'accent' }
    if (counts.agingAmberCount > 0) return { value: counts.agingAmberCount, tone: 'accent' }
  }
  // Accent, not destructive: unanswered mail is work waiting, not the firm
  // being owed or a missed deadline.
  if (href === '/admin/email-triage' && counts.emailTriageNeedsReplyCount > 0) {
    return { value: counts.emailTriageNeedsReplyCount, tone: 'accent' }
  }
  if (href === '/admin/tasks' && counts.tasksOverdueCount > 0) {
    return { value: counts.tasksOverdueCount, tone: 'destructive' }
  }
  // Late money is destructive, not accent: an overdue invoice is the firm
  // being owed, which is the same urgency as an overdue task.
  if (href === '/admin/billing' && counts.overdueInvoiceCount > 0) {
    return { value: counts.overdueInvoiceCount, tone: 'destructive' }
  }
  return null
}

export function mergeSidebarCounts(
  prev: SidebarCounts,
  next: Partial<SidebarCounts> | null | undefined,
): SidebarCounts {
  if (!next) return prev
  return {
    errors: next.errors ?? [],
    inboxNeedsReplyCount: next.inboxNeedsReplyCount ?? prev.inboxNeedsReplyCount,
    emailTriageNeedsReplyCount: next.emailTriageNeedsReplyCount ?? prev.emailTriageNeedsReplyCount,
    intakeReviewCount: next.intakeReviewCount ?? prev.intakeReviewCount,
    draftingNeedsDesignCount: next.draftingNeedsDesignCount ?? prev.draftingNeedsDesignCount,
    agingRedCount: next.agingRedCount ?? prev.agingRedCount,
    agingAmberCount: next.agingAmberCount ?? prev.agingAmberCount,
    tasksOverdueCount: next.tasksOverdueCount ?? prev.tasksOverdueCount,
    overdueInvoiceCount: next.overdueInvoiceCount ?? prev.overdueInvoiceCount,
  }
}
