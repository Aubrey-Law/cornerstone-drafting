import { sortWorkItems } from '@/lib/work/ranking'
import type { WorkItem } from '@/lib/work/types'

/**
 * Critical work that appeared after the attorney committed today's plan.
 * Focus Mode must not silently insert these; the UI surfaces them for an
 * explicit Insert into Focus / Keep focus decision.
 */
export function findMidDayCriticalItems(
  workItems: WorkItem[],
  plannedWorkKeys: Iterable<string>,
  limit = 5,
): WorkItem[] {
  const planned = new Set(plannedWorkKeys)
  return sortWorkItems(workItems.filter(item =>
    item.owner === 'firm'
    && item.state === 'open'
    && item.priorityBand === 0
    && !planned.has(item.workKey),
  )).slice(0, limit)
}
