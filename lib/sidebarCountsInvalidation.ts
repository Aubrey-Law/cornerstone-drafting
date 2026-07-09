import { revalidateTag } from 'next/cache'

export const SIDEBAR_COUNTS_TAG = 'sidebar-counts'
export const SIDEBAR_COUNTS_INVALIDATE_EVENT = 'sidebar-counts:invalidate'

/** Server: drop cached sidebar counts after mutations that affect badges. */
export function revalidateSidebarCounts() {
  revalidateTag(SIDEBAR_COUNTS_TAG)
}

/** Client: prompt the admin shell to refetch sidebar counts. */
export function invalidateSidebarCountsClient() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SIDEBAR_COUNTS_INVALIDATE_EVENT))
}
