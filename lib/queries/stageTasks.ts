/**
 * Stage-engine tasks live in the unified `tasks` table alongside manual ones and
 * the SLA plan. This module stays as the stage-engine-shaped view over that one
 * query so the stage card and the matter route keep their existing call sites.
 */
import { fetchTasks } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'

/**
 * A task the stage engine drives — a `tasks` row carrying a `stage_key`.
 *
 * Source is no longer the test. When a matter enters a stage the SLA plan
 * already has a task for, the engine attaches its checklist to that plan row
 * instead of firing a duplicate, so the stage's task is source = 'sla' as often
 * as 'stage'. The `stage_key` is what says the engine owns its dates.
 */
export type StageTaskRow = TaskRow

function withStageKey(tasks: TaskRow[]): StageTaskRow[] {
  return tasks.filter(task => task.stage_key !== null)
}

export async function fetchOpenStageTasks(): Promise<StageTaskRow[]> {
  // Filtered in the query rather than after a capped read: at the 500 default
  // this returned an arbitrary slice of every open task and kept whichever of
  // them happened to carry a stage_key. No open task carries one today, so it
  // returned nothing either way — which is exactly the kind of read that stays
  // wrong quietly once that changes.
  return withStageKey(await fetchTasks({ status: 'open', hasStageKey: true, all: true }))
}

export async function fetchOpenStageTasksForMatter(matterId: string): Promise<StageTaskRow[]> {
  return withStageKey(await fetchTasks({ status: 'open', recordId: matterId }))
}
