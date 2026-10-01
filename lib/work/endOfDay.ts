import type { StoredDailyPlan, StoredDailyPlanItem } from '@/lib/work/plans'
import { sortWorkItems } from '@/lib/work/ranking'
import type { WorkItem } from '@/lib/work/types'

export interface EndOfDayWorkItem {
  workKey: string
  title: string
  href: string | null
  dueAt: string | null
  priorityBand: number
}

export interface EndOfDayClosePreview {
  planId: string
  planDate: string
  completed: EndOfDayWorkItem[]
  blocked: EndOfDayWorkItem[]
  snoozed: EndOfDayWorkItem[]
  interrupted: EndOfDayWorkItem[]
  newCritical: EndOfDayWorkItem[]
  unresolvedRisks: EndOfDayWorkItem[]
  tomorrowFirstAction: EndOfDayWorkItem | null
}

function fallbackTitle(item: StoredDailyPlanItem) {
  return item.source_type === 'task' ? 'Completed task' : 'Planned work'
}

function toCloseItem(item: StoredDailyPlanItem, work: WorkItem | undefined): EndOfDayWorkItem {
  return {
    workKey: item.work_key,
    title: work?.title ?? fallbackTitle(item),
    href: work?.href ?? null,
    dueAt: work?.hardDueAt ?? work?.dueAt ?? null,
    priorityBand: work?.priorityBand ?? item.priority_band,
  }
}

function toWorkItem(work: WorkItem): EndOfDayWorkItem {
  return {
    workKey: work.workKey,
    title: work.title,
    href: work.href,
    dueAt: work.hardDueAt ?? work.dueAt ?? null,
    priorityBand: work.priorityBand,
  }
}

/**
 * Builds a review-only end-of-day snapshot. Closing a plan never changes the
 * underlying work records: source ownership, deadlines, and unfinished work
 * remain authoritative in the canonical work graph.
 */
export function buildEndOfDayClosePreview(plan: StoredDailyPlan, workItems: WorkItem[]): EndOfDayClosePreview {
  const workByKey = new Map(workItems.map(item => [item.workKey, item]))
  const completed: EndOfDayWorkItem[] = []
  const blocked: EndOfDayWorkItem[] = []
  const snoozed: EndOfDayWorkItem[] = []
  const interrupted: EndOfDayWorkItem[] = []

  for (const item of plan.items) {
    const work = workByKey.get(item.work_key)
    const closeItem = toCloseItem(item, work)
    if (item.status === 'completed') completed.push(closeItem)
    else if (work?.state === 'blocked') blocked.push(closeItem)
    else if (work?.state === 'snoozed') snoozed.push(closeItem)
    else interrupted.push(closeItem)
  }

  const plannedKeys = new Set(plan.items.map(item => item.work_key))
  // The close review is another projection of the canonical work graph. Do
  // not introduce a competing tie-breaker for tomorrow's first action.
  const executable = sortWorkItems(workItems.filter(item => item.owner === 'firm' && item.state === 'open'))
  const newCritical = executable
    .filter(item => item.priorityBand === 0 && !plannedKeys.has(item.workKey))
    .slice(0, 3)
    .map(toWorkItem)
  const unresolvedRisks = executable
    .filter(item => item.priorityBand <= 1)
    .slice(0, 3)
    .map(toWorkItem)

  return {
    planId: plan.id,
    planDate: plan.plan_date,
    completed,
    blocked,
    snoozed,
    interrupted,
    newCritical,
    unresolvedRisks,
    tomorrowFirstAction: executable.length ? toWorkItem(executable[0]) : null,
  }
}
