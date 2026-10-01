import type { WorkItem } from '@/lib/work/types'

/** A lane still owns `now`; the UI simply avoids rendering the same card twice. */
export function itemsExceptNow(items: WorkItem[], now: WorkItem | null): WorkItem[] {
  return now ? items.filter(item => item.workKey !== now.workKey) : items
}
