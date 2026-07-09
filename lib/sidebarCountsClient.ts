export const SIDEBAR_COUNTS_INVALIDATE_EVENT = 'sidebar-counts:invalidate'

/** Client: prompt the admin shell to refetch sidebar counts. */
export function invalidateSidebarCountsClient() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SIDEBAR_COUNTS_INVALIDATE_EVENT))
}
