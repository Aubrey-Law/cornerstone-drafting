import type { TaskRow } from '@/lib/tasks/types'
import type { PriorityBand, PriorityReason, WorkItem, WorkOwner, WorkState } from '@/lib/work/types'

export interface TaskWorkSummary {
  workKey: string
  priorityBand: PriorityBand
  priorityReasons: PriorityReason[]
  estimateMinutes: number
  owner: WorkOwner
  state: WorkState
  position: number
}

export type TaskWorkSummaries = Record<string, TaskWorkSummary>

/**
 * Index canonical work by the task evidence it contains. A deduplicated item
 * can be represented by a stronger non-task source, so looking only for a
 * `task:` work key would make that task disappear from the specialist queue.
 */
export function buildTaskWorkSummaries(items: WorkItem[]): TaskWorkSummaries {
  const summaries: TaskWorkSummaries = {}

  items.forEach((item, position) => {
    const taskIds = new Set<string>()
    if (item.sourceType === 'task') item.sourceIds.forEach(id => taskIds.add(id))
    item.evidence.forEach(entry => {
      if (entry.sourceType === 'task') taskIds.add(entry.sourceId)
    })
    if (item.workKey.startsWith('task:')) taskIds.add(item.workKey.slice('task:'.length))

    for (const taskId of taskIds) {
      if (!taskId || summaries[taskId]) continue
      summaries[taskId] = {
        workKey: item.workKey,
        priorityBand: item.priorityBand,
        priorityReasons: item.priorityReasons.slice(0, 2),
        estimateMinutes: item.estimateMinutes,
        owner: item.owner,
        state: item.state,
        position,
      }
    }
  })

  return summaries
}

/** Keep unranked long-range tasks visible after every item the graph ranked. */
export function compareTasksByWorkSummary(
  summaries: TaskWorkSummaries,
  fallback: (a: TaskRow, b: TaskRow) => number,
) {
  return (a: TaskRow, b: TaskRow): number => {
    const aPosition = summaries[a.id]?.position ?? Number.MAX_SAFE_INTEGER
    const bPosition = summaries[b.id]?.position ?? Number.MAX_SAFE_INTEGER
    return aPosition - bPosition || fallback(a, b)
  }
}
