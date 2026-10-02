import type { DailyPlanPreview, PlanLane, WorkItem } from '@/lib/work/types'
import type { CommittedFocusPlan } from '@/lib/work/committedFocus'
import { selectCommittedFocusItem } from '@/lib/work/committedFocus'

export interface MorningBriefPlan extends CommittedFocusPlan {
  items: ReadonlyArray<CommittedFocusPlan['items'][number]>
}

export interface MorningBrief {
  planStatus: 'draft' | 'committed' | 'closed' | 'uncommitted'
  now: WorkItem | null
  mustDo: WorkItem[]
  communication: WorkItem[]
  suggested: WorkItem[]
  usesCommittedAgenda: boolean
}

function workByKey(plan: DailyPlanPreview) {
  return new Map<string, WorkItem>([
    ...plan.mustDo,
    ...plan.communication,
    ...plan.suggested,
    ...plan.later,
    ...plan.waiting,
  ].map(item => [item.workKey, item]))
}

function savedLaneItems(
  plan: DailyPlanPreview,
  committed: MorningBriefPlan,
  lane: PlanLane,
): WorkItem[] {
  const items = workByKey(plan)
  return committed.items
    .toSorted((left, right) => left.position - right.position)
    .flatMap(row => {
      if (row.lane !== lane || row.status === 'completed' || row.status === 'skipped') return []
      const item = items.get(row.work_key)
      return item ? [item] : []
    })
}

/**
 * The morning email and Assistant describe an accepted agenda faithfully.
 * Until a plan is committed, they use the deterministic preview. Afterward,
 * neither surface silently injects newly-ranked work into the user's day.
 */
export function buildMorningBrief(
  preview: DailyPlanPreview,
  stored: MorningBriefPlan | null,
): MorningBrief {
  const committed = stored?.status === 'committed'
  if (!committed || !stored) {
    return {
      planStatus: stored?.status ?? 'uncommitted',
      now: preview.now,
      mustDo: preview.mustDo,
      communication: preview.communication,
      suggested: preview.suggested,
      usesCommittedAgenda: false,
    }
  }
  return {
    planStatus: 'committed',
    now: selectCommittedFocusItem(preview, stored),
    mustDo: savedLaneItems(preview, stored, 'must_do'),
    communication: savedLaneItems(preview, stored, 'communication'),
    suggested: savedLaneItems(preview, stored, 'suggested'),
    usesCommittedAgenda: true,
  }
}
