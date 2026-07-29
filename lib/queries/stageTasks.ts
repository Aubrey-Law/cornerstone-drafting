/**
 * Stage-engine tasks now live in the unified `tasks` table alongside manual
 * ones. This module stays as the stage-engine-shaped view over that one query
 * so the SLA card and the matter route keep their existing call sites.
 */
import { fetchTasks } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'

/** A task fired by the stage engine — a `tasks` row with `source = 'stage'`. */
export type StageTaskRow = TaskRow

export async function fetchOpenStageTasks(): Promise<StageTaskRow[]> {
  return fetchTasks({ source: 'stage', status: 'open' })
}

export async function fetchOpenStageTasksForMatter(matterId: string): Promise<StageTaskRow[]> {
  return fetchTasks({ source: 'stage', status: 'open', recordId: matterId })
}
