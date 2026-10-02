import type { DailyPlanPreview, PlanLane, WorkItem } from '@/lib/work/types'

export interface CommittedFocusPlanItem {
  work_key: string
  lane: PlanLane
  position: number
  status: 'planned' | 'started' | 'completed' | 'skipped'
  /** Present on persisted plan rows; optional so Focus Mode stays presentation-only. */
  block_start?: string | null
  block_end?: string | null
  estimate_minutes?: number
}

export interface CommittedFocusPlan {
  status: 'draft' | 'committed' | 'closed'
  items: readonly CommittedFocusPlanItem[]
}

function workItemsByKey(preview: DailyPlanPreview) {
  return new Map<string, WorkItem>([
    ...preview.mustDo,
    ...preview.communication,
    ...preview.suggested,
    ...preview.later,
    ...preview.waiting,
  ].map(item => [item.workKey, item]))
}

function executable(item: WorkItem | undefined): item is WorkItem {
  return Boolean(item
    && item.owner === 'firm'
    && item.state === 'open'
    && item.priorityBand < 4)
}

/**
 * A commitment is deliberate: after the user commits a day, Focus Mode must
 * follow that saved order rather than silently substituting a fresh backlog
 * ranking. A source that has become unavailable, waiting, blocked, snoozed,
 * or complete is skipped honestly; the caller can ask the user to replan.
 */
export function selectCommittedFocusItem(
  preview: DailyPlanPreview,
  plan: CommittedFocusPlan | null,
): WorkItem | null {
  if (plan?.status !== 'committed') return preview.now

  const byKey = workItemsByKey(preview)
  for (const row of plan.items.toSorted((a, b) => a.position - b.position)) {
    if (row.lane === 'later' || row.status === 'completed' || row.status === 'skipped') continue
    const item = byKey.get(row.work_key)
    if (executable(item)) return item
  }
  return null
}
