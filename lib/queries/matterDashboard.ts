import { fetchMattersList } from '@/lib/queries/matters'
import { fetchMatterAgingTiles, type MatterAgingTiles } from '@/lib/queries/pipelineAging'
import { fetchTasks } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'
import { buildMatterDashboard, type MatterDashboardSnapshot } from '@/lib/matters/dashboard'

/**
 * Everything the matter dashboard renders, in one round of reads.
 *
 * Mirrors `fetchCrmDashboard`: the IO lives here and the arithmetic lives in
 * `lib/matters/dashboard.ts`, so the numbers on the page can be tested without a
 * database. The secondary reads degrade to a fallback rather than taking the page
 * down with them — a dashboard missing its task card is worth more than an error
 * screen.
 */

const OPEN_TASK_LIMIT = 5

const EMPTY_TILES: MatterAgingTiles = {
  active: 0,
  red: 0,
  amber: 0,
  green: 0,
  overdue: 0,
  snoozed: 0,
}

export interface MatterDashboardData {
  snapshot: MatterDashboardSnapshot
  aging: MatterAgingTiles
  tasks: TaskRow[]
  error: string | null
}

export async function fetchMatterDashboard(viewerId: string | null): Promise<MatterDashboardData> {
  const [mattersResult, aging, tasks] = await Promise.all([
    fetchMattersList(),
    fetchMatterAgingTiles().catch(() => EMPTY_TILES),
    fetchTasks({ scope: 'all', status: 'open', viewerId, limit: OPEN_TASK_LIMIT }).catch(
      () => [] as TaskRow[],
    ),
  ])

  return {
    snapshot: buildMatterDashboard(mattersResult.matters),
    aging,
    tasks,
    error: mattersResult.error,
  }
}
