export interface SidebarCounts {
  intakeReviewCount: number
  draftingNeedsDesignCount: number
  agingRedCount: number
  agingAmberCount: number
  unassignedCallsCount: number
  tasksOverdueCount: number
}

export type SidebarBadgeTone = 'destructive' | 'accent'

export interface SidebarBadge {
  value: number
  tone: SidebarBadgeTone
}

export const EMPTY_SIDEBAR_COUNTS: SidebarCounts = {
  intakeReviewCount: 0,
  draftingNeedsDesignCount: 0,
  agingRedCount: 0,
  agingAmberCount: 0,
  unassignedCallsCount: 0,
  tasksOverdueCount: 0,
}

export function getNavBadge(href: string, counts: SidebarCounts): SidebarBadge | null {
  if (href === '/admin/matters' && counts.intakeReviewCount > 0) {
    return { value: counts.intakeReviewCount, tone: 'destructive' }
  }
  if (href === '/admin/drafting') {
    // Aging folded into the Drafting hub: overdue matters take badge priority.
    if (counts.agingRedCount > 0) return { value: counts.agingRedCount, tone: 'destructive' }
    if (counts.draftingNeedsDesignCount > 0) return { value: counts.draftingNeedsDesignCount, tone: 'accent' }
    if (counts.agingAmberCount > 0) return { value: counts.agingAmberCount, tone: 'accent' }
  }
  if (href === '/admin/tasks' && counts.tasksOverdueCount > 0) {
    return { value: counts.tasksOverdueCount, tone: 'destructive' }
  }
  if (href === '/admin/calls' && counts.unassignedCallsCount > 0) {
    return { value: counts.unassignedCallsCount, tone: 'accent' }
  }
  return null
}

export function mergeSidebarCounts(
  prev: SidebarCounts,
  next: Partial<SidebarCounts> | null | undefined,
): SidebarCounts {
  if (!next) return prev
  return {
    intakeReviewCount: next.intakeReviewCount ?? prev.intakeReviewCount,
    draftingNeedsDesignCount: next.draftingNeedsDesignCount ?? prev.draftingNeedsDesignCount,
    agingRedCount: next.agingRedCount ?? prev.agingRedCount,
    agingAmberCount: next.agingAmberCount ?? prev.agingAmberCount,
    unassignedCallsCount: next.unassignedCallsCount ?? prev.unassignedCallsCount,
    tasksOverdueCount: next.tasksOverdueCount ?? prev.tasksOverdueCount,
  }
}
