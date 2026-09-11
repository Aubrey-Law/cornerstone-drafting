import 'server-only'

import { buildCrmDashboard, type CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import {
  CRM_DASHBOARD_MAX_PEOPLE,
  fetchCrmDashboardPeople,
  fetchCrmPeople,
  fetchCrmStages,
} from '@/lib/queries/cornerstoneCrm'
import { fetchTasks } from '@/lib/queries/tasks'
import type { TaskRow } from '@/lib/tasks/types'

/** How many rows the "recent people" table shows, and so how many it reads. */
const RECENT_PEOPLE = 8

export interface CrmDashboardData {
  snapshot: CrmDashboardSnapshot
  tasks: TaskRow[]
  tasksError: string | null
  /**
   * True when the contact base is larger than one read covers, so the counts
   * below are a sample. The page says so rather than presenting them as
   * totals — which is exactly what the old 500-row cap did silently.
   */
  truncated: boolean
  peopleCeiling: number
  error: string | null
}

/**
 * Everything the CRM overview renders.
 *
 * The counts read the whole contact base in narrow pages; the eight rows the
 * recent-people table renders are read separately, with the joins that table
 * needs. Before this the dashboard loaded 500 enriched rows and counted those,
 * so at 221 contacts and several more per new matter its totals were on their
 * way to becoming a sample of the book rather than the book.
 *
 * A failed task read is reported independently without taking the whole
 * dashboard down or presenting an empty task list as an all-clear.
 */
export async function fetchCrmDashboard(viewerId: string | null): Promise<CrmDashboardData> {
  const [peopleResult, recentResult, stagesResult, tasks] = await Promise.all([
    fetchCrmDashboardPeople(),
    fetchCrmPeople(RECENT_PEOPLE, { orderBy: 'created_at' }),
    fetchCrmStages(),
    // The five most urgent, now that the read is ordered by the stored due
    // date — this was an arbitrary five of 1,024 open tasks.
    fetchTasks({ scope: 'all', status: 'open', viewerId, limit: 5 }).then(tasks => ({ tasks, error: null })).catch(() => ({ tasks: [] as TaskRow[], error: 'Tasks are unavailable. Please retry.' })),
  ])

  return {
    snapshot: buildCrmDashboard({
      people: peopleResult.people,
      recent: recentResult.people,
      stages: stagesResult.stages,
      recentLimit: RECENT_PEOPLE,
    }),
    tasks: tasks.tasks,
    tasksError: tasks.error,
    truncated: peopleResult.truncated,
    peopleCeiling: CRM_DASHBOARD_MAX_PEOPLE,
    error: peopleResult.error ?? recentResult.error ?? stagesResult.error,
  }
}
