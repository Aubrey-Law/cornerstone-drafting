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
  return withStageKey(await fetchTasks({ status: 'open' }))
}

export async function fetchOpenStageTasksForMatter(matterId: string): Promise<StageTaskRow[]> {
  return withStageKey(await fetchTasks({ status: 'open', recordId: matterId }))
}
