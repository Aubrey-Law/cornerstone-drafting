import { revalidateTag } from 'next/cache'

export const SIDEBAR_COUNTS_TAG = 'sidebar-counts'

/** Server: drop cached sidebar counts after mutations that affect badges. */
export function revalidateSidebarCounts() {
  revalidateTag(SIDEBAR_COUNTS_TAG, 'max')
}
